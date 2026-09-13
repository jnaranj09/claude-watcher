// Shortcut expander — unit tests for the ONE Ctrl+Alt+<letter> chord that opens the
// ExpanderBox over EmbeddedTerminal.
//
// Gate: `unit` (jsdom) project.
// Covers:
//   - the expander chord opens the box, is swallowed (preventDefault + stopPropagation,
//     returns false), and focus moves into the box's input;
//   - a changed expanderKey (settingsStore) takes effect WITHOUT recreating the terminal — the
//     old letter no longer opens it, the new one does (terminal.md: read through a ref);
//   - Enter in the box writes the expanded text over the terminal's EXISTING port, closes the
//     box, and refocuses the terminal;
//   - NO carriage return is ever appended (spec S-1: the text is TYPED, never submitted);
//   - Escape closes the box, writes nothing, and refocuses the terminal;
//   - a failed expansion (e.g. a missing $1 value) keeps the box open, writes nothing, and
//     shows the ONE fail-closed error line;
//   - bare letters, plain Ctrl, extra modifiers, keyup, IME composition and AltGr all pass
//     through untouched (UX-DR21: keystrokes belong to the agent) and never open the box;
//   - any OTHER Ctrl+Alt chord is left COMPLETELY untouched — neither preventDefault nor
//     stopPropagation — so xterm still emits its ESC + control byte to the pty (design §5
//     hazard 3). This is the guarantee that keeps the namespace cheap for claude;
//   - the shipped Ctrl+V takeover still wins and still posts \x16;
//   - a dead pane (null port) does not throw when the chord fires;
//   - deactivating the terminal closes an open box;
//   - EDITING the shortcut list does NOT dispose or re-open the terminal — the terminal.md
//     regression guard (the list is read through a ref, never a create-effect dependency) — and
//     an edited alias is immediately reachable in the box;
//   - Task 11: the box lists only Global + the ACTIVE workspace's rows.
//
// The xterm-capture harness is the one proven in EmbeddedTerminal.clipboard.test.tsx.

import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'
import { shortcutsStore } from '../stores/shortcutsStore'
import { workspacesStore } from '../stores/workspacesStore'
import { DEFAULT_WORKSPACE_ID } from '../../../shared/schemas/workspace'
import { settingsStore } from '../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'

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
  alias: 'ap',
  text: 'I explicitly approve $1',
  workspaceId: null
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
  settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS })
})

afterEach(() => {
  cleanupFn?.()
  cleanupFn = undefined
  shortcutsStore.setState({ shortcuts: [], loaded: false })
  workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS })
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
function chordEvent(
  init: Partial<KeyboardEvent> & { key: string; getModifierState?: () => boolean }
): SpiedKeyboardEvent {
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

function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`)
}
function typeInBox(value: string): void {
  act(() => {
    const input = byTestId('expander-input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function pressInBox(key: string): void {
  act(() => {
    byTestId('expander-input')?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    )
  })
}

describe('EmbeddedTerminal shortcut expander', () => {
  it('the expander chord opens the box and is swallowed', () => {
    render({ terminalId: 't-x-1' })
    deliverPort('t-x-1', lastOpenToken())
    const e = ctrlAlt('x')
    let result = true
    act(() => {
      result = capturedKeyHandlers[0]!(e)
    })
    expect(result).toBe(false)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    expect(byTestId('expander-box')).not.toBeNull()
    expect(document.activeElement).toBe(byTestId('expander-input'))
  })

  it('follows a changed expanderKey without recreating the terminal', () => {
    render({ terminalId: 't-x-2' })
    deliverPort('t-x-2', lastOpenToken())
    const disposeSpy = vi.spyOn(capturedTerminals[0]!, 'dispose')
    act(() => settingsStore.getState().applyPatch({ expanderKey: 'Q' }))
    expect(disposeSpy).not.toHaveBeenCalled()
    expect(termFakes.open).toHaveBeenCalledTimes(1)

    const old = ctrlAlt('x')
    act(() => void capturedKeyHandlers[0]!(old))
    expect(byTestId('expander-box')).toBeNull()
    expect(old.preventDefault).not.toHaveBeenCalled()

    act(() => void capturedKeyHandlers[0]!(ctrlAlt('q')))
    expect(byTestId('expander-box')).not.toBeNull()
  })

  it('Enter in the box writes the expanded text over the port, closes, and refocuses', () => {
    render({ terminalId: 't-x-3' })
    const { port1 } = deliverPort('t-x-3', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const focusSpy = vi.spyOn(capturedTerminals[0]!, 'focus')
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    typeInBox('ap 1234')
    pressInBox('Enter')
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'I explicitly approve 1234' })
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(byTestId('expander-box')).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('NEVER appends a carriage return (typed, not submitted)', () => {
    render({ terminalId: 't-x-4' })
    const { port1 } = deliverPort('t-x-4', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    typeInBox('ap 1')
    pressInBox('Enter')
    for (const [msg] of postSpy.mock.calls) {
      expect((msg as { data: string }).data).not.toContain('\r')
      expect((msg as { data: string }).data).not.toContain('\n')
    }
  })

  it('Escape closes the box, writes nothing, refocuses the terminal', () => {
    render({ terminalId: 't-x-5' })
    const { port1 } = deliverPort('t-x-5', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const focusSpy = vi.spyOn(capturedTerminals[0]!, 'focus')
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    pressInBox('Escape')
    expect(byTestId('expander-box')).toBeNull()
    expect(postSpy).not.toHaveBeenCalled()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('a failed expansion keeps the box open and writes nothing', () => {
    render({ terminalId: 't-x-6' })
    const { port1 } = deliverPort('t-x-6', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    typeInBox('ap')
    pressInBox('Enter')
    expect(byTestId('expander-error')?.textContent).toBe('Missing value for $1')
    expect(byTestId('expander-box')).not.toBeNull()
    expect(postSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['a bare letter', { key: 'x' }],
    ['plain Ctrl', { key: 'x', ctrlKey: true }],
    ['plain Alt', { key: 'x', altKey: true }],
    ['Ctrl+Alt+Shift', { key: 'X', ctrlKey: true, altKey: true, shiftKey: true }],
    ['Ctrl+Alt+Meta', { key: 'x', ctrlKey: true, altKey: true, metaKey: true }],
    ['a keyup', { key: 'x', ctrlKey: true, altKey: true, type: 'keyup' }],
    ['a composing key', { key: 'x', ctrlKey: true, altKey: true, isComposing: true }],
    [
      'an AltGr composition',
      { key: 'x', ctrlKey: true, altKey: true, getModifierState: () => true }
    ]
  ])('does not open on %s and lets xterm handle it', (_label, init) => {
    render({ terminalId: 't-x-7' })
    deliverPort('t-x-7', lastOpenToken())
    let result = false
    act(() => {
      result = capturedKeyHandlers[0]!(
        chordEvent(
          init as Partial<KeyboardEvent> & { key: string; getModifierState?: () => boolean }
        )
      )
    })
    expect(result).toBe(true)
    expect(byTestId('expander-box')).toBeNull()
  })

  // Design §5 hazard 3 of the original shortcuts spec: Ctrl+Alt IS encodable by a pty, so any
  // chord that is not the expander's must reach it completely untouched.
  it('leaves any OTHER Ctrl+Alt chord completely untouched', () => {
    render({ terminalId: 't-x-8' })
    const { port1 } = deliverPort('t-x-8', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const e = ctrlAlt('q')
    let result = false
    act(() => {
      result = capturedKeyHandlers[0]!(e)
    })
    expect(result).toBe(true)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
    expect(postSpy).not.toHaveBeenCalled()
    expect(byTestId('expander-box')).toBeNull()
  })

  it('leaves the Ctrl+V takeover intact', () => {
    render({ terminalId: 't-x-9' })
    const { port1 } = deliverPort('t-x-9', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    let result = true
    act(() => {
      result = capturedKeyHandlers[0]!(chordEvent({ key: 'v', ctrlKey: true }))
    })
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: '\x16' })
    expect(result).toBe(false)
  })

  it('does not throw and does not open on a dead pane (no port)', () => {
    render({ terminalId: 't-x-10' })
    // No deliverPort(): portRef is null. The chord must still be safe.
    expect(() => act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))).not.toThrow()
  })

  it('closes the box when the terminal is deactivated', () => {
    const r = render({ terminalId: 't-x-11', active: true })
    deliverPort('t-x-11', lastOpenToken())
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    expect(byTestId('expander-box')).not.toBeNull()
    act(() => {
      r.root.render(<EmbeddedTerminal terminalId="t-x-11" active={false} />)
    })
    expect(byTestId('expander-box')).toBeNull()
  })

  it('picks up an EDITED shortcut list WITHOUT recreating the terminal', () => {
    render({ terminalId: 't-x-12' })
    const { port1 } = deliverPort('t-x-12', lastOpenToken())
    const postSpy = vi.spyOn(port1, 'postMessage')
    const disposeSpy = vi.spyOn(capturedTerminals[0]!, 'dispose')
    act(() => shortcutsStore.getState().hydrate([{ ...APPROVE, alias: 'ok', text: 'okay $1' }]))
    expect(disposeSpy).not.toHaveBeenCalled()
    expect(termFakes.open).toHaveBeenCalledTimes(1)
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    typeInBox('ok now')
    pressInBox('Enter')
    expect(postSpy).toHaveBeenCalledWith({ type: 'input', data: 'okay now' })
  })

  it('lists only Global + the ACTIVE workspace rows in the box', () => {
    act(() =>
      workspacesStore.setState({
        activeId: 'w1',
        workspaces: [
          { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null },
          { id: 'w2', name: 'Other', color: 'rose', defaultCwd: null }
        ],
        loaded: true
      })
    )
    shortcutsStore.setState({
      shortcuts: [
        APPROVE,
        { ...APPROVE, id: 'sc-own', alias: 'own', workspaceId: 'w1' },
        { ...APPROVE, id: 'sc-other', alias: 'oth', workspaceId: 'w2' }
      ],
      loaded: true
    })
    render({ terminalId: 't-x-13' })
    deliverPort('t-x-13', lastOpenToken())
    act(() => void capturedKeyHandlers[0]!(ctrlAlt('x')))
    const aliases = [...document.querySelectorAll('[data-testid^="expander-option-"]')].map((el) =>
      el.getAttribute('data-testid')
    )
    expect(aliases).toEqual(['expander-option-ap', 'expander-option-own'])
  })
})
