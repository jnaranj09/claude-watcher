// Focused-view keys (R1, R27, R10 of the 2026-09-23 bug hunt) — decision (b): claude KEEPS every
// key while its terminal has focus; the app's chords work only with focus OUTSIDE the terminal.
//
// The older App keydown tests dispatch on `window` and so never see what xterm does with a key.
// These tests mount the REAL xterm (App renders the real EmbeddedTerminal) and press the keys
// where the operator's keystrokes actually land: xterm's helper textarea. They also press them on
// the `.xterm` root (inside the terminal, but past xterm's own textarea listener), which is the
// case that proves App's OWN guard — not xterm's stopPropagation — keeps the key for claude.
//
// R27: Ctrl+W no longer archives from anywhere. Archive is the bar's button only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined
let requestQuit: ReturnType<typeof vi.fn>

beforeEach(() => {
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    quitGuard: null,
    stopConfirm: null
  })
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
      /* no-op shim — jsdom has no layout */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }
  ;(window as unknown as { pty: unknown }).pty = {
    smokeConfig: vi.fn(() => Promise.resolve({ enabled: false, electron: '', abi: '', node: '' }))
  }
  ;(window as unknown as { watch: unknown }).watch = {
    onEvents: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {})
  }
  ;(window as unknown as { attention: unknown }).attention = {
    onActivate: vi.fn(() => () => {}),
    onReminder: vi.fn(() => () => {}),
    reportFocusedTerminal: vi.fn()
  }
  const settings = {
    version: 1,
    soundEnabled: true,
    terminalFontSize: 14,
    reminderCount: 3,
    reminderFirstDelayMinutes: 2
  }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve(settings)),
    set: vi.fn(() => Promise.resolve(settings))
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'term-1', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'term-1', workspaceId: 'default' })
    ),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined)),
    archiveSession: vi.fn(() => Promise.resolve(undefined)),
    deleteSession: vi.fn(() => Promise.resolve(undefined))
  }
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  requestQuit = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { quit: unknown }).quit = {
    requestQuit,
    confirm: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onGuardShow: vi.fn(() => () => {})
  }
  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

async function renderFocused(terminalId = 'term-keys'): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush()
  act(() => {
    boardStore.setState({ viewMode: 'focused', focusedTerminalId: terminalId })
  })
  await flush()
  return r
}

function visibleTerminal(r: RenderResult): HTMLElement {
  const frame = r.container.querySelector<HTMLElement>(
    `[data-testid="embedded-terminal"][data-terminal-id="${boardStore.getState().focusedTerminalId ?? ''}"]`
  )
  if (!frame) throw new Error('no focused terminal frame')
  return frame
}

/** Where a real keystroke lands: xterm's helper textarea. */
function xtermTextarea(r: RenderResult): HTMLTextAreaElement {
  const ta = visibleTerminal(r).querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
  if (!ta) throw new Error('xterm did not open (no helper textarea)')
  return ta
}

/** Inside the terminal, but past xterm's own textarea keydown listener. */
function xtermRoot(r: RenderResult): HTMLElement {
  const root = visibleTerminal(r).querySelector<HTMLElement>('.xterm')
  if (!root) throw new Error('xterm did not open (no .xterm root)')
  return root
}

const CHORDS: Array<[string, KeyboardEventInit]> = [
  ['Ctrl+W', { key: 'w', ctrlKey: true }],
  ['Esc', { key: 'Escape' }],
  ['Ctrl+N', { key: 'n', ctrlKey: true }],
  ['Ctrl+Q', { key: 'q', ctrlKey: true }]
]

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

function expectNoAppAction(): void {
  expect(window.launch.archiveSession).not.toHaveBeenCalled()
  expect(window.launch.pickDirectory).not.toHaveBeenCalled()
  expect(requestQuit).not.toHaveBeenCalled()
  expect(boardStore.getState().viewMode).toBe('focused')
}

describe('focused-view keys — the terminal keeps every key (R1, decision b)', () => {
  it.each(CHORDS)('%s typed into xterm (its textarea) does nothing app-side', async (_n, init) => {
    const r = await renderFocused()
    press(xtermTextarea(r), init)
    await flush()
    expectNoAppAction()
  })

  it.each(CHORDS)(
    '%s from inside the terminal is ignored by App itself (not only by xterm)',
    async (_n, init) => {
      const r = await renderFocused()
      const e = press(xtermRoot(r), init)
      await flush()
      expectNoAppAction()
      // App must not preventDefault a key it leaves to the terminal.
      expect(e.defaultPrevented).toBe(false)
    }
  )
})

describe('focused-view keys — outside the terminal the app chords work', () => {
  it('Esc on the page returns to the board', async () => {
    await renderFocused()
    press(document.body, { key: 'Escape' })
    await flush()
    expect(boardStore.getState().viewMode).toBe('board')
  })

  it('Ctrl+N on the page opens the new-session flow', async () => {
    await renderFocused()
    press(document.body, { key: 'n', ctrlKey: true })
    await flush()
    expect(window.launch.pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Q on the page requests quit', async () => {
    await renderFocused()
    press(document.body, { key: 'q', ctrlKey: true })
    await flush()
    expect(requestQuit).toHaveBeenCalledTimes(1)
  })
})

describe('Ctrl+W never archives (R27)', () => {
  it('Ctrl+W with focus outside the terminal does NOT archive, and still never closes the window', async () => {
    await renderFocused()
    const e = press(document.body, { key: 'w', ctrlKey: true })
    await flush()
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(e.defaultPrevented).toBe(true)
  })

  it('Ctrl+W right after a rail/row click (focus on a button) does NOT archive', async () => {
    const r = await renderFocused()
    const back = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-archive"]')
    back?.focus()
    press(back ?? document.body, { key: 'w', ctrlKey: true })
    await flush()
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
  })
})
