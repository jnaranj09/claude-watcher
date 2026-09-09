// Phrase shortcuts — unit tests for the Ctrl+Alt+<A-Z> 1..3 chord SEQUENCE handler in
// EmbeddedTerminal.
//
// Gate: `unit` (jsdom) project.
// Covers:
//   - a matching chord posts { type:'input', data:<phrase> } on the terminal's EXISTING port
//     and suppresses xterm (returns false, preventDefault + stopPropagation called);
//   - NO carriage return is ever appended (spec S-1: the phrase is TYPED, never submitted);
//   - bare letters, plain Ctrl, extra modifiers, keyup, IME composition and AltGr all pass
//     through untouched (UX-DR21: keystrokes belong to the agent);
//   - an UNMATCHED Ctrl+Alt chord is left COMPLETELY untouched — neither preventDefault nor
//     stopPropagation — so xterm still emits its ESC + control byte to the pty (design §5
//     hazard 3). This is the guarantee that keeps the namespace cheap for claude;
//   - the sequence machine: a bound prefix pends and is swallowed, the 2-chord completion posts
//     exactly one phrase, the 750 ms timeout resolves a bound prefix, Escape cancels without
//     firing, and deactivating the terminal cancels a half-typed sequence;
//   - the pending indicator tracks pending imperatively;
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
import { SEQUENCE_TIMEOUT_MS } from '../shortcuts/sequence'

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
  keys: ['Ctrl+Alt+A'],
  text: 'I explicitly approve',
  workspaceId: null
}

/** The two-shortcut set that exercises the prefix case: O alone AND O+A. */
const SEQ = [
  { id: 'sc-o', name: 'o', keys: ['Ctrl+Alt+O'], text: 'phrase-O', workspaceId: null },
  {
    id: 'sc-oa',
    name: 'oa',
    keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
    text: 'phrase-OA',
    workspaceId: null
  }
]

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
    getModifierState: () => false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init
  }
  return e as unknown as SpiedKeyboardEvent
}

/** A Ctrl+Alt chord event. */
function ctrlAlt(key: string): SpiedKeyboardEvent {
  return chordEvent({ key, ctrlKey: true, altKey: true })
}

describe('EmbeddedTerminal phrase shortcuts', () => {
  it('types the phrase on a matching single chord and suppresses xterm', () => {
    render({ terminalId: 't-sc-1' })
    const { port1 } = deliverPort('t-sc-1', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const handler = capturedKeyHandlers[0]
    expect(handler).not.toBeNull()

    const e = ctrlAlt('a')
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
    capturedKeyHandlers[0]!(ctrlAlt('a'))

    for (const [msg] of postSpy.mock.calls) {
      expect((msg as { data: string }).data).not.toContain('\r')
      expect((msg as { data: string }).data).not.toContain('\n')
    }
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a bare letter', { key: 'a' }],
    ['plain Ctrl', { key: 'a', ctrlKey: true }],
    ['plain Alt', { key: 'a', altKey: true }],
    ['the old Ctrl+Shift namespace', { key: 'A', ctrlKey: true, shiftKey: true }],
    ['Ctrl+Alt+Shift', { key: 'A', ctrlKey: true, altKey: true, shiftKey: true }],
    ['Ctrl+Alt+Meta', { key: 'a', ctrlKey: true, altKey: true, metaKey: true }],
    ['a keyup', { key: 'a', ctrlKey: true, altKey: true, type: 'keyup' }],
    ['a composing key', { key: 'a', ctrlKey: true, altKey: true, isComposing: true }],
    [
      'an AltGr composition',
      { key: 'a', ctrlKey: true, altKey: true, getModifierState: () => true }
    ]
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

  // Design §5 hazard 3: Ctrl+Alt IS encodable by a pty, so an UNMATCHED chord must reach it
  // completely untouched — xterm then emits ESC + the control byte exactly as today. Calling
  // preventDefault here would silently steal the whole namespace from claude.
  it('leaves an UNMATCHED Ctrl+Alt chord completely untouched', () => {
    render({ terminalId: 't-sc-4' })
    const { port1 } = deliverPort('t-sc-4', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    const e = ctrlAlt('q')
    const result = capturedKeyHandlers[0]!(e)

    expect(result).toBe(true)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('leaves the Ctrl+V takeover intact and first', () => {
    render({ terminalId: 't-sc-5' })
    const { port1 } = deliverPort('t-sc-5', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    const result = capturedKeyHandlers[0]!(chordEvent({ key: 'v', ctrlKey: true }))

    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: '\x16' })
    expect(result).toBe(false)
  })

  it('does not throw when the port is gone (dead pane)', () => {
    render({ terminalId: 't-sc-6' })
    // No deliverPort() — portRef stays null.
    expect(() => capturedKeyHandlers[0]!(ctrlAlt('a'))).not.toThrow()
  })

  it('picks up an EDITED shortcut list WITHOUT recreating the terminal', () => {
    render({ terminalId: 't-sc-7' })
    const { port1 } = deliverPort('t-sc-7', lastOpenToken())
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

    capturedKeyHandlers[0]!(ctrlAlt('a'))

    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'approved, proceed' })
  })
})

describe('EmbeddedTerminal chord sequences', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    shortcutsStore.setState({ shortcuts: SEQ, loaded: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('swallows a bound PREFIX without typing anything yet', () => {
    render({ terminalId: 't-seq-1' })
    const { port1 } = deliverPort('t-seq-1', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    const e = ctrlAlt('o')
    expect(capturedKeyHandlers[0]!(e)).toBe(false)
    expect(postSpy).not.toHaveBeenCalled()
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('types the two-chord phrase when the sequence completes', () => {
    render({ terminalId: 't-seq-2' })
    const { port1 } = deliverPort('t-seq-2', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    capturedKeyHandlers[0]!(ctrlAlt('a'))

    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'phrase-OA' })
  })

  it('types the PREFIX phrase when the timeout expires', () => {
    render({ terminalId: 't-seq-3' })
    const { port1 } = deliverPort('t-seq-3', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    expect(postSpy).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS)
    })
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'phrase-O' })
  })

  it('does not fire the prefix before the timeout elapses', () => {
    render({ terminalId: 't-seq-4' })
    const { port1 } = deliverPort('t-seq-4', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS - 1)
    })
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('cancels a pending sequence on Escape WITHOUT typing the prefix', () => {
    render({ terminalId: 't-seq-5' })
    const { port1 } = deliverPort('t-seq-5', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    expect(capturedKeyHandlers[0]!(chordEvent({ key: 'Escape' }))).toBe(true)
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS * 2)
    })
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('resolves the prefix and lets an ordinary key through', () => {
    render({ terminalId: 't-seq-6' })
    const { port1 } = deliverPort('t-seq-6', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    expect(capturedKeyHandlers[0]!(chordEvent({ key: 'x' }))).toBe(true)
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'phrase-O' })
  })

  it('cancels a pending sequence when the terminal is deactivated', () => {
    const r = render({ terminalId: 't-seq-7', active: true })
    const { port1 } = deliverPort('t-seq-7', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    act(() => {
      r.root.render(<EmbeddedTerminal terminalId="t-seq-7" active={false} />)
    })
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS * 2)
    })
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('cancels a pending sequence when focus leaves the terminal', () => {
    render({ terminalId: 't-seq-8' })
    const { port1 } = deliverPort('t-seq-8', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    act(() => {
      // The listener is on the xterm HOST (the container div), not the frame: focus lives on
      // xterm's inner textarea and `focusout` bubbles UP to the host.
      const host = document.querySelector('[data-testid="embedded-terminal"]')?.firstElementChild
      expect(host).not.toBeNull()
      host?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS * 2)
    })
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('cancels a pending sequence when the shortcut list changes underneath it', () => {
    render({ terminalId: 't-seq-9' })
    const { port1 } = deliverPort('t-seq-9', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    act(() => {
      shortcutsStore.setState({ shortcuts: [...SEQ], loaded: true })
    })
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS * 2)
    })
    expect(postSpy).not.toHaveBeenCalled()
  })

  // Task 9 — the pending indicator, written imperatively (textContent + hidden), never React
  // state: a re-render per chord must not go anywhere near the terminal (terminal.md).
  it('shows the pending chords while a sequence is open and hides them when it resolves', () => {
    render({ terminalId: 't-seq-hint' })
    deliverPort('t-seq-hint', lastOpenToken())
    const hint = document.querySelector('[data-testid="chord-pending"]') as HTMLElement
    expect(hint).not.toBeNull()
    expect(hint.hidden).toBe(true)

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    expect(hint.hidden).toBe(false)
    expect(hint.textContent).toContain('Ctrl+Alt+O')

    capturedKeyHandlers[0]!(ctrlAlt('a'))
    expect(hint.hidden).toBe(true)
    expect(hint.textContent).toBe('')
  })

  it('hides the indicator when the timeout resolves the prefix', () => {
    render({ terminalId: 't-seq-hint2' })
    deliverPort('t-seq-hint2', lastOpenToken())
    const hint = document.querySelector('[data-testid="chord-pending"]') as HTMLElement

    capturedKeyHandlers[0]!(ctrlAlt('o'))
    expect(hint.hidden).toBe(false)
    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS)
    })
    expect(hint.hidden).toBe(true)
  })
})
