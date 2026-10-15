// The EmbeddedTerminal test harness: the xterm/addon mocks, the browser APIs jsdom omits, the
// fake `window.terminal`, and the preload's port forward.
//
// `vi.mock` is hoisted above every import, so its factory cannot close over an imported binding.
// It CAN import this module dynamically, and gets the same instance the test file imports, so the
// registries below are the ones the test reads:
//   vi.mock('@xterm/xterm', async () => (await import('../test/terminalHarness')).xtermMock())
//
// This module never imports `@xterm/*` or EmbeddedTerminal statically: it is loaded before them.
import { vi } from 'vitest'
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { TERMINAL_PORT_TAG, type TerminalExitEvent } from '../../../shared/ipc/contract'

/** Every Terminal constructed, in creation order. Cleared by `stubTerminalBridge`. */
export const capturedTerminals: XtermTerminal[] = []
/** The custom key handler each Terminal was given (same index as `capturedTerminals`). */
export const capturedKeyHandlers: Array<((e: KeyboardEvent) => boolean) | null> = []
/** One entry per constructed fake WebglAddon: fire its context-loss listener, see its dispose. */
export const webglAddons: { fireContextLoss: () => void; dispose: ReturnType<typeof vi.fn> }[] = []
/** One entry per constructed fake FitAddon. */
export const fitAddons: { fit: ReturnType<typeof vi.fn> }[] = []

/** The REAL @xterm/xterm, with Terminal wrapped only to capture each instance and its custom key
 *  handler — `options`, `input()`, `refresh()` stay xterm's own. */
export async function xtermMock(): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await vi.importActual<Record<string, any>>('@xterm/xterm')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OriginalTerminal: new (...args: any[]) => XtermTerminal = actual['Terminal']
  class TerminalCapture extends OriginalTerminal {
    readonly _captureIndex: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this._captureIndex = capturedTerminals.length
      capturedTerminals.push(this as unknown as XtermTerminal)
      capturedKeyHandlers.push(null)
    }
    override attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void {
      capturedKeyHandlers[this._captureIndex] = handler
      super.attachCustomKeyEventHandler(handler)
    }
  }
  return { ...actual, Terminal: TerminalCapture }
}

/** A fake @xterm/addon-fit. The real FitAddon needs a live render service to measure a cell (jsdom
 *  has no layout); tests assert THAT it fits, not what dimensions it computes. */
export function fitAddonMock(): Record<string, unknown> {
  class FakeFitAddon {
    public fit = vi.fn()
    public dispose = vi.fn()
    constructor() {
      fitAddons.push({ fit: this.fit })
    }
    // xterm calls activate() from term.loadAddon() — a no-op is enough here.
    activate(): void {
      /* no-op: the real addon would measure a cell jsdom cannot lay out */
    }
    proposeDimensions(): undefined {
      return undefined
    }
  }
  return { FitAddon: FakeFitAddon }
}

/** A fake @xterm/addon-webgl whose context-loss listener a test fires by hand (jsdom has no WebGL2,
 *  so the real addon always throws and its loss handler is unreachable). */
export function webglAddonMock(): Record<string, unknown> {
  class FakeWebglAddon {
    private listener: (() => void) | null = null
    public dispose = vi.fn()
    constructor() {
      webglAddons.push({
        fireContextLoss: () => this.listener?.(),
        dispose: this.dispose
      })
    }
    // xterm calls activate() from term.loadAddon() — a no-op is enough here.
    activate(): void {
      /* no-op: the real addon would take a WebGL2 context jsdom cannot give */
    }
    onContextLoss(cb: () => void): { dispose: () => void } {
      this.listener = cb
      return { dispose: (): void => {} }
    }
  }
  return { WebglAddon: FakeWebglAddon }
}

/** The browser APIs xterm assumes and jsdom omits: matchMedia and ResizeObserver. */
export function stubXtermBrowserApis(): void {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* no-op shim — jsdom has no layout; the byte/fit path is smoke-tested */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }
}

/** The installed window.terminal fakes — drive an exit, assert open/stop. */
export interface TerminalFakes {
  open: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  /** CH.terminalExit, to every live listener (a card's terminal AND its nested shell subscribe). */
  emitExit: (info: TerminalExitEvent) => void
}

let fakes: TerminalFakes | undefined

/** beforeEach: clear the registries, stub the browser APIs, install a fake window.terminal. */
export function stubTerminalBridge(): TerminalFakes {
  capturedTerminals.length = 0
  capturedKeyHandlers.length = 0
  webglAddons.length = 0
  fitAddons.length = 0
  stubXtermBrowserApis()
  const exitCbs = new Set<(info: TerminalExitEvent) => void>()
  const installed: TerminalFakes = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn((cb: (info: TerminalExitEvent) => void) => {
      exitCbs.add(cb)
      return () => {
        exitCbs.delete(cb)
      }
    }),
    emitExit: (info) => {
      for (const cb of [...exitCbs]) cb(info)
    }
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: installed.open,
    resize: installed.resize,
    stop: installed.stop,
    onExit: installed.onExit
  }
  fakes = installed
  return installed
}

/**
 * The preload forwarding a port to the renderer via window.postMessage, with a real
 * `new MessageChannel().port1` (jsdom has browser MessagePort). The forward carries the per-open
 * `openToken` main echoes back, so pass the one the component minted (`lastOpenToken`).
 * Returns the forwarded port1 and the other end, port2, for assertions.
 */
export function deliverPort(
  terminalId: string,
  openToken: string
): { port1: MessagePort; port2: MessagePort } {
  const channel = new MessageChannel()
  const event = new MessageEvent('message', {
    data: { tag: TERMINAL_PORT_TAG, terminalId, openToken },
    ports: [channel.port1]
  })
  window.dispatchEvent(event)
  return { port1: channel.port1, port2: channel.port2 }
}

/** The openToken passed to the LATEST `window.terminal.open(terminalId, openToken)` call: minted
 *  inside the component per create-effect run, so a test reads it back from the open spy. */
export function lastOpenToken(): string {
  if (fakes === undefined) throw new Error('stubTerminalBridge() was not called')
  const calls = fakes.open.mock.calls
  return (calls[calls.length - 1]?.[1] ?? '') as string
}
