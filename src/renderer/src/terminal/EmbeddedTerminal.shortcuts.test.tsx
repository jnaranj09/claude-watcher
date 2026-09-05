// Phrase shortcuts — unit tests for the Ctrl+Shift+<A-Z> chord handler in EmbeddedTerminal.
//
// Gate: `unit` (jsdom) project.
// Covers:
//   - a matching chord posts { type:'input', data:<phrase> } on the terminal's EXISTING port
//     and suppresses xterm (returns false, preventDefault + stopPropagation called);
//   - NO carriage return is ever appended (spec S-1: the phrase is TYPED, never submitted);
//   - bare letters, plain Ctrl, extra modifiers, keyup, IME composition and unmapped chords
//     all pass through untouched (UX-DR21: keystrokes belong to the agent);
//   - the shipped Ctrl+V takeover still wins and still posts \x16;
//   - a dead pane (null port) does not throw;
//   - EDITING the shortcut list does NOT dispose or re-open the terminal — the terminal.md
//     regression guard (the list is read through a ref, never a create-effect dependency).
//
// The xterm-capture harness is the one proven in EmbeddedTerminal.clipboard.test.tsx.

import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'
import { shortcutsStore } from '../stores/shortcutsStore'

// ── xterm mock — captures instances + attachCustomKeyEventHandler ─────────────

const capturedTerminals: XtermTerminal[] = []
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
}

let termFakes: TerminalFakes
let cleanupFn: (() => void) | undefined

const APPROVE = {
  id: 'sc-1',
  name: 'approve',
  keys: 'Ctrl+Shift+A',
  text: 'I explicitly approve'
}

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

  termFakes = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: termFakes.open,
    resize: termFakes.resize,
    stop: termFakes.stop,
    onExit: termFakes.onExit
  }
  ;(window as unknown as { clipboard: unknown }).clipboard = {
    readText: vi.fn(() => Promise.resolve('')),
    writeText: vi.fn(() => Promise.resolve())
  }

  shortcutsStore.setState({ shortcuts: [APPROVE], loaded: true })
})

afterEach(() => {
  cleanupFn?.()
  cleanupFn = undefined
  shortcutsStore.setState({ shortcuts: [], loaded: false })
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

type SpiedKeyboardEvent = KeyboardEvent & {
  preventDefault: ReturnType<typeof vi.fn>
  stopPropagation: ReturnType<typeof vi.fn>
}

/** A KeyboardEvent as xterm's custom handler receives it, with spies on the two suppressors. */
function chordEvent(init: Partial<KeyboardEvent> & { key: string }): SpiedKeyboardEvent {
  const e = {
    type: 'keydown',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init
  }
  return e as unknown as SpiedKeyboardEvent
}

describe('EmbeddedTerminal phrase shortcuts', () => {
  it('types the phrase on a matching chord and suppresses xterm', () => {
    render({ terminalId: 't-sc-1' })
    const { port1 } = deliverPort('t-sc-1', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const handler = capturedKeyHandlers[0]
    expect(handler).not.toBeNull()

    const e = chordEvent({ key: 'A', ctrlKey: true, shiftKey: true })
    const result = handler!(e)

    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'I explicitly approve' })
    expect(result).toBe(false)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
  })

  it('NEVER appends a carriage return (the phrase is typed, not submitted)', () => {
    render({ terminalId: 't-sc-2' })
    const { port1 } = deliverPort('t-sc-2', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    capturedKeyHandlers[0]!(chordEvent({ key: 'A', ctrlKey: true, shiftKey: true }))

    for (const [msg] of postSpy.mock.calls) {
      expect((msg as { data: string }).data).not.toContain('\r')
      expect((msg as { data: string }).data).not.toContain('\n')
    }
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a bare letter', { key: 'a' }],
    ['plain Ctrl (no Shift)', { key: 'a', ctrlKey: true }],
    ['Ctrl+Shift with Alt', { key: 'A', ctrlKey: true, shiftKey: true, altKey: true }],
    ['Ctrl+Shift with Meta', { key: 'A', ctrlKey: true, shiftKey: true, metaKey: true }],
    ['an unmapped chord', { key: 'Z', ctrlKey: true, shiftKey: true }],
    ['a keyup', { key: 'A', ctrlKey: true, shiftKey: true, type: 'keyup' }],
    ['a composing key', { key: 'A', ctrlKey: true, shiftKey: true, isComposing: true }]
  ])('posts nothing and lets xterm handle %s', (_label, init) => {
    render({ terminalId: 't-sc-3' })
    const { port1 } = deliverPort('t-sc-3', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    const result = capturedKeyHandlers[0]!(
      chordEvent(init as Partial<KeyboardEvent> & { key: string })
    )

    expect(postSpy).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('leaves the Ctrl+V takeover intact and first', () => {
    render({ terminalId: 't-sc-4' })
    const { port1 } = deliverPort('t-sc-4', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    const result = capturedKeyHandlers[0]!(chordEvent({ key: 'v', ctrlKey: true }))

    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: '\x16' })
    expect(result).toBe(false)
  })

  it('does not throw when the port is gone (dead pane)', () => {
    render({ terminalId: 't-sc-5' })
    // No deliverPort() — portRef stays null.
    expect(() =>
      capturedKeyHandlers[0]!(chordEvent({ key: 'A', ctrlKey: true, shiftKey: true }))
    ).not.toThrow()
  })

  it('picks up an EDITED shortcut list WITHOUT recreating the terminal', () => {
    render({ terminalId: 't-sc-6' })
    const { port1 } = deliverPort('t-sc-6', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const disposeSpy = vi.spyOn(capturedTerminals[0]!, 'dispose')
    const openCallsBefore = termFakes.open.mock.calls.length

    act(() => {
      shortcutsStore.setState({
        shortcuts: [{ ...APPROVE, text: 'approved, proceed' }],
        loaded: true
      })
    })

    // terminal.md: editing shortcuts must NEVER tear down a live terminal. Asserted BEFORE the
    // behavioral check so a regression names the lifecycle, not a stale-port symptom.
    expect(disposeSpy).not.toHaveBeenCalled()
    expect(termFakes.open.mock.calls.length).toBe(openCallsBefore)
    expect(capturedTerminals).toHaveLength(1)

    capturedKeyHandlers[0]!(chordEvent({ key: 'A', ctrlKey: true, shiftKey: true }))

    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'approved, proceed' })
  })
})
