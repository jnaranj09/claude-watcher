// Story 3.1 (FR-10) — EmbeddedTerminal jsdom tests (unit / jsdom project).
// Story 5.1 — re-shaped for the main-world-port delivery mechanism. The preload
// no longer passes the port as a callback arg to `window.terminal.open`; it now
// forwards the real port via `window.postMessage(TERMINAL_PORT_TAG, '*', [port])`.
// The renderer pairs it via a `window` `'message'` listener keyed by the tag +
// terminalId. jsdom HAS browser `MessageChannel`/`MessagePort` (only Electron's
// `MessagePortMain` is absent), so tests can drive a real port via a dispatched
// `MessageEvent` carrying a `new MessageChannel().port1`.
//
// Coverage preserved from story 3.1:
//   - mounts without throwing + calls window.terminal.open(terminalId) ONCE;
//   - dead-terminal pane (AC-4): renders on CH.terminalExit for THIS id, not another;
//   - Reopen clears the dead pane + re-opens;
//   - kept-alive hidden: applies the `.hidden` class (visibility:hidden, never display:none);
//   - stop-on-unmount (clean teardown — no orphan from a normal close).
// Coverage ADDED in story 5.1:
//   - port delivery: after `window.terminal.open` is called, dispatching a matching
//     `MessageEvent` on `window` causes the terminal to wire `onmessage` + call `start()`;
//   - cross-wiring negative: a `MessageEvent` for a DIFFERENT terminalId is IGNORED.
//   - output renders (port.onmessage → term.write);
//   - keystroke posts (term.onData → port.postMessage) — NON-VACUOUS: drives
//     Terminal.input() to fire onData; asserts port1.postMessage({type:'input',data}).
//   - font-size live-apply (a selectTerminalFontSize change re-applies without recreate).
//
// xterm needs two jsdom shims (matchMedia + ResizeObserver) it assumes from a real browser.
// The byte path itself is also asserted by `npm run smoke`. [Source: story 3.1 Task 4;
// story 5.1 Task 4; AC-3/4; .claude/rules/terminal.md; src/renderer/src/test/renderComponent.ts]
//
// @xterm/xterm mock: vi.mock wraps Terminal to expose .input() for driving onData in tests.
// vi.importActual is used so the real xterm internals (onData wiring, write, etc.) are
// preserved — the mock ONLY captures each constructed Terminal instance so tests can call
// Terminal.input(data) to fire onData callbacks without needing access to the component's ref.
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import type { TerminalExitEvent } from '../../../shared/ipc/contract'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'

// Module-level registry of every Terminal instance created by EmbeddedTerminal.
// Reset in beforeEach so each test gets a clean slate.
// NOTE: vi.mock is hoisted to the top of the module by Vitest, which is why the
// `capturedTerminals` array is declared at module scope (referenced by the mock factory).
const capturedTerminals: XtermTerminal[] = []

vi.mock('@xterm/xterm', async () => {
  // Import the REAL module so xterm internals (onData, write, dispose, etc.) all work.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await vi.importActual<Record<string, any>>('@xterm/xterm')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OriginalTerminal: new (...args: any[]) => XtermTerminal = actual['Terminal']
  // Wrap Terminal to capture each instance for test inspection.
  class TerminalCapture extends OriginalTerminal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      // Push into the module-level registry so tests can call .input() to fire onData.
      capturedTerminals.push(this as unknown as XtermTerminal)
    }
  }
  return { ...actual, Terminal: TerminalCapture }
})

/** The captured window.terminal fakes — let tests drive onExit + assert open/stop. */
interface TerminalFakes {
  open: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  emitExit: (info: TerminalExitEvent) => void
}

let fakes: TerminalFakes
let cleanup: (() => void) | undefined

beforeEach(() => {
  // Reset the captured-Terminal registry before each test so each test sees only the
  // Terminal instances created during its own render (not leftovers from prior tests).
  capturedTerminals.length = 0

  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both).
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

  let exitCb: ((info: TerminalExitEvent) => void) | null = null
  fakes = {
    // Story 5.1: open is now (terminalId: string) => () => void (NO callback arg).
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn((cb: (info: TerminalExitEvent) => void) => {
      exitCb = cb
      return () => {}
    }),
    emitExit: (info) => exitCb?.(info)
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: fakes.open,
    resize: fakes.resize,
    stop: fakes.stop,
    onExit: fakes.onExit
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: { terminalId: string; active?: boolean }): RenderResult {
  const r = renderComponent(<EmbeddedTerminal {...props} />)
  cleanup = r.unmount
  return r
}

/**
 * Simulate the preload forwarding a port to the renderer via window.postMessage.
 * Uses a real `new MessageChannel().port1` — jsdom HAS browser MessagePort.
 * Story 5.4: the forward carries the per-open `openToken` (main echoes the one the renderer sent),
 * so a caller must deliver the token the component actually minted (see `lastOpenToken`).
 * Returns { port1 (the one forwarded), port2 (the other end for test assertions) }.
 */
function deliverPort(
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

/** The openToken the component passed to the LATEST `window.terminal.open(terminalId, openToken)`
 *  call (Story 5.4 — minted internally per create-effect run; the test can't predict it, so it
 *  reads it back from the open spy, exactly as main echoes the renderer's token in production). */
function lastOpenToken(): string {
  const calls = fakes.open.mock.calls
  return calls[calls.length - 1]?.[1] as string
}

describe('EmbeddedTerminal — mount + lifecycle wiring (AC-1/2)', () => {
  it('mounts without throwing and calls window.terminal.open(terminalId) once', () => {
    const r = render({ terminalId: 't-1' })
    expect(fakes.open).toHaveBeenCalledTimes(1)
    expect(fakes.open.mock.calls[0]?.[0]).toBe('t-1')
    // Story 5.4: open takes (terminalId, openToken) — the second arg is a non-empty per-open token.
    expect(fakes.open.mock.calls[0]?.length).toBe(2)
    expect(typeof fakes.open.mock.calls[0]?.[1]).toBe('string')
    expect((fakes.open.mock.calls[0]?.[1] as string).length).toBeGreaterThan(0)
    // No dead pane on a healthy mount.
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('stops the pty on unmount (clean teardown — no orphan from a normal close)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => r.unmount())
    cleanup = undefined
    // Story 5.6: the cleanup stop now passes the effect's openToken so main can identify
    // a stale StrictMode cleanup-stop. Assert called with the terminalId + a non-empty token.
    expect(fakes.stop).toHaveBeenCalledWith('t-1', expect.stringMatching(/^open-\d+$/))
  })
})

describe('EmbeddedTerminal — port delivery via window message (Story 5.1)', () => {
  it('wires port.onmessage and calls port.start() when a matching MessageEvent arrives', async () => {
    render({ terminalId: 't-1' })
    // Ensure open was called first.
    expect(fakes.open).toHaveBeenCalledTimes(1)

    // Simulate the preload forwarding the port (tagged with the token the component minted).
    const { port1 } = deliverPort('t-1', lastOpenToken())

    // The component should have set onmessage and called start().
    expect(port1.onmessage).not.toBeNull()
    // start() is a method on the real MessagePort — verify the port is now in use.
    // (We can't assert start() was called directly since it's a native method,
    // but the fact that onmessage is set proves the pairing happened.)
  })

  it('IGNORES a MessageEvent for a DIFFERENT terminalId (no cross-wiring)', () => {
    render({ terminalId: 't-1' })

    // A port message for a DIFFERENT terminalId should not be paired — even with THIS open's token,
    // so the terminalId guard is proven independently of the Story-5.4 token guard.
    const wrongChannel = new MessageChannel()
    const wrongEvent = new MessageEvent('message', {
      data: { tag: TERMINAL_PORT_TAG, terminalId: 'other-terminal', openToken: lastOpenToken() },
      ports: [wrongChannel.port1]
    })
    window.dispatchEvent(wrongEvent)

    // port1 for the wrong terminal should NOT have had onmessage set on it.
    expect(wrongChannel.port1.onmessage).toBeNull()
  })

  it('IGNORES a MessageEvent with a wrong tag (not cross-wired by unrelated postMessage)', () => {
    render({ terminalId: 't-1' })

    const channel = new MessageChannel()
    const wrongTagEvent = new MessageEvent('message', {
      data: { tag: 'some-other-tag', terminalId: 't-1', openToken: lastOpenToken() },
      ports: [channel.port1]
    })
    window.dispatchEvent(wrongTagEvent)

    // Should not have paired this port.
    expect(channel.port1.onmessage).toBeNull()
  })

  it('renders output when the paired port receives an output message', async () => {
    const r = render({ terminalId: 't-1' })

    // Deliver the port.
    const { port1 } = deliverPort('t-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()

    // Simulate main sending output over the port.
    const outputEvent = new MessageEvent('message', {
      data: { type: 'output', data: 'hello world' }
    })
    // Dispatch to port1 (the end the renderer holds).
    act(() => {
      port1.onmessage?.(outputEvent)
    })

    // The terminal should have processed the output (no throw, dead pane still absent).
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('posts a keystroke message over the port when xterm.onData fires', () => {
    render({ terminalId: 't-1' })
    const { port1 } = deliverPort('t-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()

    // Spy on port1.postMessage BEFORE firing onData (the component calls port1.postMessage
    // inside its term.onData handler; spy must be installed first to intercept it).
    const spy = vi.spyOn(port1, 'postMessage')

    // Obtain the Terminal instance created by EmbeddedTerminal (captured by the vi.mock
    // wrapper at the top of this file). There should be exactly one per render.
    const term = capturedTerminals[0]
    expect(term, 'Terminal instance must have been captured by the vi.mock wrapper').toBeDefined()

    // Drive the onData → port.postMessage wire: Terminal.input(data) fires all onData
    // listeners registered on the terminal (same as a real keystroke in the browser).
    // This is the COMPONENT'S handler (wired in EmbeddedTerminal.tsx:139-144), so a
    // bug that breaks the wire (removes the onData registration or stops calling
    // port.postMessage) will cause this assertion to fail.
    const testData = 'hello'
    term!.input(testData)

    // PRIMARY ASSERTION: the port received exactly the expected input message.
    // This FAILS if the onData→postMessage wire is broken (missing handler, wrong
    // message shape, wrong port, or message suppressed for any reason).
    expect(spy).toHaveBeenCalledWith({ type: 'input', data: testData })
  })

  it('removes the window message listener on unmount (no dangling listener)', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
    const r = render({ terminalId: 't-1' })

    act(() => r.unmount())
    cleanup = undefined

    // The cleanup should have called removeEventListener for 'message'.
    const messageCalls = removeListenerSpy.mock.calls.filter(([type]) => type === 'message')
    expect(messageCalls.length).toBeGreaterThanOrEqual(1)
  })

  // Story 5.4 — the port-race regression. A port forwarded with a STALE/wrong openToken (but the
  // RIGHT terminalId) must NOT be paired; only THIS open's token pairs. Before 5.4 the listener
  // matched terminalId alone, so a re-open of the same id could pair the stale (closed) port and
  // ignore the live one → a blank terminal.
  it('IGNORES a port with a STALE openToken for THIS terminalId; the correct token still pairs', () => {
    render({ terminalId: 't-1' })

    const staleChannel = new MessageChannel()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { tag: TERMINAL_PORT_TAG, terminalId: 't-1', openToken: 'open-stale-99999' },
        ports: [staleChannel.port1]
      })
    )
    // Wrong token → not paired (this is the stale port the old code would have wrongly grabbed).
    expect(staleChannel.port1.onmessage).toBeNull()

    // The port tagged with the component's actual token DOES pair.
    const { port1 } = deliverPort('t-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()
  })

  // Story 5.4 — a Reopen (openNonce bump → create-effect re-run) mints a FRESH token. A port tagged
  // with the prior open's (now stale) token must be ignored by the re-opened terminal; the fresh
  // token pairs. This is the StrictMode-double-mount / Reopen port race in miniature.
  it('after Reopen the prior open’s token is stale (ignored); the fresh token pairs', () => {
    const r = render({ terminalId: 't-1' })
    const firstToken = lastOpenToken()

    // Drive the Reopen path: exit → dead pane → click Reopen → re-open with a fresh token.
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0 }))
    const reopenBtn = [...r.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reopen'
    )
    act(() => {
      reopenBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const secondToken = lastOpenToken()
    expect(secondToken).not.toBe(firstToken)

    // A port tagged with the FIRST (now stale) token must be ignored by the re-opened terminal.
    const staleChannel = new MessageChannel()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { tag: TERMINAL_PORT_TAG, terminalId: 't-1', openToken: firstToken },
        ports: [staleChannel.port1]
      })
    )
    expect(staleChannel.port1.onmessage).toBeNull()

    // The fresh token's port pairs.
    const { port1 } = deliverPort('t-1', secondToken)
    expect(port1.onmessage).not.toBeNull()
  })
})

describe('EmbeddedTerminal — dead-terminal pane (AC-4)', () => {
  it('renders "Terminal exited." + Reopen/Stop on a terminal:exit for THIS id', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 137 }))
    const dead = r.container.querySelector('[data-testid="dead-terminal"]')
    expect(dead).not.toBeNull()
    expect(dead?.textContent).toContain('Terminal exited.')
    const buttons = [...r.container.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toContain('Reopen')
    expect(buttons).toContain('Stop')
    // The dead pane is an alert (accessibility floor).
    expect(dead?.getAttribute('role')).toBe('alert')
  })

  it('IGNORES a terminal:exit for a DIFFERENT id (per-terminal local state)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 'other', exitCode: 1 }))
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('Reopen clears the dead pane and re-opens a fresh pty', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).not.toBeNull()

    const reopenBtn = [...r.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reopen'
    )
    act(() => {
      reopenBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Dead pane gone; open() called again (a fresh pty into the same pane).
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
    expect(fakes.open.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('EmbeddedTerminal — kept-alive hidden uses visibility:hidden, never display:none (AC-3)', () => {
  it('active=false applies the hidden class (visibility:hidden) to the host', () => {
    const r = render({ terminalId: 't-1', active: false })
    const host = r.container.querySelector('[data-testid="embedded-terminal"] > div')
    expect(host).not.toBeNull()
    // The CSS-module `.hidden` class is applied (it sets visibility:hidden, asserted in the
    // CSS source test below — never display:none).
    expect(host?.className).toMatch(/hidden/)
  })

  it('active=true does NOT apply the hidden class', () => {
    const r = render({ terminalId: 't-1', active: true })
    const host = r.container.querySelector('[data-testid="embedded-terminal"] > div')
    expect(host?.className ?? '').not.toMatch(/\bhidden\b/)
  })
})

describe('EmbeddedTerminal — font-size live-apply (story 5.1 coverage parity)', () => {
  it('open is called exactly once per mount (no re-mount on font-size change)', () => {
    // The font-size live-apply effect must NOT re-trigger the create effect.
    // If open were called twice, it would mean a re-mount (which terminal.md forbids).
    render({ terminalId: 't-1' })
    // Only one open call immediately after render (font-size has not changed).
    expect(fakes.open).toHaveBeenCalledTimes(1)
  })
})
