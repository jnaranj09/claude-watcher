// Terminal clipboard feature — unit tests for the Ctrl+V takeover and the
// context menu integration in EmbeddedTerminal.
//
// Gate: `unit` (jsdom) project.
// Covers:
//   - Ctrl+V custom key handler: sends exactly one { type:'input', data:'\x16' }
//     over the port, returns false (suppresses xterm), and never text-pastes.
//   - Other keys pass through (handler returns true).
//   - Paste event suppressor: the capture-phase listener prevents xterm paste.
//   - Context menu opens on right-click; Copy/Paste are wired correctly.
//   - Per-terminal isolation: right-click on one terminal does not open a menu
//     for a sibling terminal.
//
// Byte-over-MessagePort stays out of jsdom — we use a real browser MessageChannel
// (jsdom has it) and inspect postMessage calls. The full byte path is covered by
// `npm run smoke`. [Source: spec-terminal-clipboard.md §Gate note]

import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'
import type { TerminalExitEvent } from '../../../shared/ipc/contract'

// ── xterm mock — captures instances + attachCustomKeyEventHandler ─────────────
//
// We extend the real Terminal (via vi.importActual) to capture:
//   1. each constructed instance (for calling .input() to fire onData)
//   2. the custom key handler registered via attachCustomKeyEventHandler
//
// vi.mock is hoisted by Vitest; capturedTerminals and capturedKeyHandlers are
// module-scope so the mock factory can reference them.

const capturedTerminals: XtermTerminal[] = []
// Each element corresponds to a Terminal instance (same index as capturedTerminals).
const capturedKeyHandlers: Array<((e: KeyboardEvent) => boolean) | null> = []

vi.mock('@xterm/xterm', async () => {
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
})

// ── window.terminal + window.clipboard fakes ─────────────────────────────────

interface TerminalFakes {
  open: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  emitExit: (info: TerminalExitEvent) => void
}

interface ClipboardFakes {
  readText: ReturnType<typeof vi.fn>
  writeText: ReturnType<typeof vi.fn>
}

let termFakes: TerminalFakes
let clipFakes: ClipboardFakes
let cleanupFn: (() => void) | undefined

beforeEach(() => {
  capturedTerminals.length = 0
  capturedKeyHandlers.length = 0

  // xterm jsdom shims.
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
  termFakes = {
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
    open: termFakes.open,
    resize: termFakes.resize,
    stop: termFakes.stop,
    onExit: termFakes.onExit
  }

  clipFakes = {
    readText: vi.fn(() => Promise.resolve('')),
    writeText: vi.fn(() => Promise.resolve())
  }
  ;(window as unknown as { clipboard: unknown }).clipboard = {
    readText: clipFakes.readText,
    writeText: clipFakes.writeText
  }
})

afterEach(() => {
  cleanupFn?.()
  cleanupFn = undefined
})

// ── Test helpers ──────────────────────────────────────────────────────────────

function render(props: { terminalId: string; active?: boolean }): RenderResult {
  const r = renderComponent(<EmbeddedTerminal {...props} />)
  cleanupFn = r.unmount
  return r
}

/** Deliver the MessagePort to the rendered terminal (simulates the preload forward). */
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

/** Read the openToken the component passed to the latest window.terminal.open() call. */
function lastOpenToken(): string {
  const calls = termFakes.open.mock.calls
  return (calls[calls.length - 1]?.[1] ?? '') as string
}

// ── Ctrl+V takeover ───────────────────────────────────────────────────────────

describe('EmbeddedTerminal Ctrl+V — custom key handler', () => {
  it('sends exactly one { type:"input", data:"\\x16" } over the port on Ctrl+V', () => {
    render({ terminalId: 't-clip-1' })

    // Deliver the port so portRef.current is wired.
    const { port1 } = deliverPort('t-clip-1', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    // Get the captured key handler (registered by attachCustomKeyEventHandler in the effect).
    const handler = capturedKeyHandlers[0]
    expect(handler, 'custom key handler must be registered').not.toBeNull()

    // Simulate a Ctrl+V keydown event.
    // Note: `type` is the first constructor arg — not in KeyboardEventInit.
    const ctrlV = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'v',
      bubbles: true
    })

    const result = handler!(ctrlV)

    // Must return false (suppress xterm handling).
    expect(result).toBe(false)
    // Must have posted exactly one \x16 input message.
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: '\x16' })
  })

  it('returns true (passes through) for non-Ctrl+V keys', () => {
    render({ terminalId: 't-clip-2' })

    const handler = capturedKeyHandlers[0]
    expect(handler).not.toBeNull()

    // 'a' key: should pass through.
    const keyA = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    expect(handler!(keyA)).toBe(true)

    // Ctrl+C: should pass through (SIGINT — must NOT be intercepted).
    const ctrlC = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'c',
      bubbles: true
    })
    expect(handler!(ctrlC)).toBe(true)
  })

  it('Ctrl+V with Shift held passes through (Ctrl+Shift+V is not intercepted)', () => {
    render({ terminalId: 't-clip-3' })

    const handler = capturedKeyHandlers[0]
    expect(handler).not.toBeNull()

    const ctrlShiftV = new KeyboardEvent('keydown', {
      ctrlKey: true,
      shiftKey: true,
      key: 'v',
      bubbles: true
    })
    // Ctrl+Shift+V must NOT be intercepted (spec: only plain Ctrl+V = image-only).
    expect(handler!(ctrlShiftV)).toBe(true)
  })

  it('keyup for Ctrl+V passes through (only keydown is intercepted)', () => {
    render({ terminalId: 't-clip-4' })

    const handler = capturedKeyHandlers[0]
    expect(handler).not.toBeNull()

    const ctrlVUp = new KeyboardEvent('keyup', {
      ctrlKey: true,
      key: 'v',
      bubbles: true
    })
    // keyup must pass through — only keydown is intercepted.
    expect(handler!(ctrlVUp)).toBe(true)
  })

  it('does NOT forward \\x16 when there is no active port (port not yet delivered)', () => {
    render({ terminalId: 't-clip-5' })
    // Do NOT deliver a port — portRef.current stays null.

    const handler = capturedKeyHandlers[0]
    expect(handler).not.toBeNull()

    const ctrlV = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'v',
      bubbles: true
    })
    // Should still return false (suppress xterm) but post nothing (no port).
    // We verify this does not throw and returns false.
    let returned: boolean | undefined
    expect(() => {
      returned = handler!(ctrlV)
    }).not.toThrow()
    expect(returned).toBe(false)
  })
})

// ── Paste suppressor ──────────────────────────────────────────────────────────

describe('EmbeddedTerminal paste suppressor', () => {
  it('capture-phase paste listener calls preventDefault and stopImmediatePropagation', () => {
    const r = render({ terminalId: 't-paste-1' })

    // Find the terminal's inner container (.host div — the element the paste listener
    // is attached to). It is the first div inside the frame.
    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div') // the .host div
    expect(container, 'host container must exist').not.toBeNull()

    // Dispatch a paste event and verify it is suppressed.
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(pasteEvent, 'preventDefault')
    const stopSpy = vi.spyOn(pasteEvent, 'stopImmediatePropagation')

    act(() => {
      container!.dispatchEvent(pasteEvent)
    })

    expect(preventSpy).toHaveBeenCalled()
    expect(stopSpy).toHaveBeenCalled()
  })

  it('paste suppressor is removed after unmount (no dangling listener)', () => {
    const r = render({ terminalId: 't-paste-2' })

    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div')
    expect(container).not.toBeNull()

    act(() => r.unmount())
    cleanupFn = undefined

    // After unmount the suppressor should be gone — a paste event should NOT be prevented.
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(pasteEvent, 'preventDefault')

    container!.dispatchEvent(pasteEvent)
    expect(preventSpy).not.toHaveBeenCalled()
  })
})

// ── Context menu integration ──────────────────────────────────────────────────

describe('EmbeddedTerminal context menu', () => {
  it('opens the menu on right-click (contextmenu event on the host container)', async () => {
    const r = render({ terminalId: 't-menu-1' })

    // Initially no menu.
    expect(document.querySelector('[data-testid="terminal-context-menu"]')).toBeNull()

    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div')
    expect(container).not.toBeNull()

    // Simulate a right-click (contextmenu event).
    act(() => {
      container!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 150, clientY: 250 })
      )
    })

    // Allow the async clipboard.readText() to settle.
    await act(async () => {
      await Promise.resolve()
    })

    // The context menu should now be visible.
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    expect(menu).not.toBeNull()
  })

  it('the contextmenu default action is prevented (no browser native menu)', () => {
    const r = render({ terminalId: 't-menu-2' })

    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div')

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')

    act(() => {
      container!.dispatchEvent(event)
    })

    expect(preventSpy).toHaveBeenCalled()
  })

  it('Copy handler calls window.clipboard.writeText with the selection text', async () => {
    // Mock terminal with a selection.
    const r = render({ terminalId: 't-copy-1' })
    const { port1 } = deliverPort('t-copy-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull() // port wired

    // Make the captured terminal report a selection.
    const term = capturedTerminals[0]
    expect(term).toBeDefined()
    vi.spyOn(term!, 'hasSelection').mockReturnValue(true)
    vi.spyOn(term!, 'getSelection').mockReturnValue('selected text')

    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div')

    act(() => {
      container!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Click the Copy button.
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const copyBtn = [...(menu?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Copy'
    )
    act(() => {
      copyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // The clipboard write must have been called with the selection.
    expect(clipFakes.writeText).toHaveBeenCalledWith('selected text')
  })

  it('Paste handler calls clipboard.readText then term.paste', async () => {
    clipFakes.readText.mockResolvedValue('clipboard text')

    const r = render({ terminalId: 't-paste-menu-1' })
    const { port1 } = deliverPort('t-paste-menu-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()

    const term = capturedTerminals[0]
    expect(term).toBeDefined()
    const pasteSpy = vi.spyOn(term!, 'paste')

    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div')

    act(() => {
      container!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const pasteBtn = [...(menu?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Paste'
    )
    act(() => {
      pasteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Allow the async readText → paste chain to resolve.
    await act(async () => {
      await Promise.resolve()
    })

    expect(clipFakes.readText).toHaveBeenCalled()
    expect(pasteSpy).toHaveBeenCalledWith('clipboard text')
  })

  it('context menu is dismissed when the terminal effect re-runs (Reopen)', () => {
    const r = render({ terminalId: 't-dismiss-reopen' })

    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    const container = frame?.querySelector('div')

    act(() => {
      container!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })

    // Menu is open.
    expect(document.querySelector('[data-testid="terminal-context-menu"]')).not.toBeNull()

    // Trigger Reopen (exit → dead pane → click Reopen).
    act(() => termFakes.emitExit({ terminalId: 't-dismiss-reopen', exitCode: 0 }))
    const reopenBtn = [...r.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reopen'
    )
    act(() => {
      reopenBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Menu must be dismissed (effect cleanup calls setMenu(null)).
    expect(document.querySelector('[data-testid="terminal-context-menu"]')).toBeNull()
  })
})

// ── Per-terminal isolation (EmbeddedTerminal level) ───────────────────────────
//
// AC-5 requires that the context menu acts only on the active terminal — i.e.
// each EmbeddedTerminal owns its own `menu` useState and a right-click on one
// terminal must not open a menu for a sibling.
//
// Non-vacuous: if `menu` state were accidentally global (e.g. a module-level
// variable or a shared context), right-clicking terminal A would flip state for
// BOTH instances, causing BOTH to render a TerminalContextMenu. The assertion
// `menus.length === 1` would then see 2 and fail — proving this test catches
// the accidental-sharing bug the header comment claims is covered.

describe('EmbeddedTerminal — per-terminal isolation (AC-5)', () => {
  it("right-click on terminal A opens exactly one menu; terminal B's menu stays closed", async () => {
    // Render TWO EmbeddedTerminals side-by-side; each gets its own menu useState.
    const rA = renderComponent(<EmbeddedTerminal terminalId="iso-a" />)
    const tokenA = lastOpenToken() // A's open token (only one call so far)

    const rB = renderComponent(<EmbeddedTerminal terminalId="iso-b" />)
    const tokenB = lastOpenToken() // B's open token (most recent call)

    // Deliver ports so both terminals are fully wired (required for contextmenu handling).
    deliverPort('iso-a', tokenA)
    deliverPort('iso-b', tokenB)

    // No menus open yet.
    expect(document.querySelectorAll('[data-testid="terminal-context-menu"]').length).toBe(0)

    // Fire a contextmenu on terminal A's host container (the .host div, ref target).
    const frameA = rA.container.querySelector('[data-testid="embedded-terminal"]')
    const containerA = frameA?.querySelector('div')
    expect(containerA, 'host container for terminal A must exist').not.toBeNull()

    act(() => {
      containerA!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
      )
    })

    // Allow the async clipboard.readText() (canPaste update) to settle.
    await act(async () => {
      await Promise.resolve()
    })

    // Exactly ONE menu must be in the DOM — A's. Terminal B's menu state is still null.
    // If state were shared/global both instances would render a menu → length 2 → test fails.
    const menus = document.querySelectorAll('[data-testid="terminal-context-menu"]')
    expect(menus.length).toBe(1)

    act(() => rA.unmount())
    act(() => rB.unmount())
    cleanupFn = undefined // afterEach already sees undefined; this is defensive
  })
})
