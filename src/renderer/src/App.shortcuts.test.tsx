// Phrase shortcuts — App-level integration tests for the entry point.
//
// Covers: the `⌨` header button opens the ShortcutsDialog; the dialog counts as a MODAL
// (UX-DR14 single-modal rule refuses Ctrl+N while it is open); ✕ closes it; Escape from the
// page body closes it; and loadShortcuts() runs once on mount beside loadTemplates().
// Harness mirrors App.templates.test.tsx (fake window bridges, no Electron).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import { shortcutsStore } from './stores/shortcutsStore'
import type { Shortcut } from '../../shared/ipc/contract'

const SC: Shortcut = {
  id: 'sc-1',
  name: 'approve',
  alias: 'ap',
  text: 'I explicitly approve',
  workspaceId: null
}

/** Resolve a microtask/Promise chain inside act() so async effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined
let pickDirectory: ReturnType<typeof vi.fn>
let shortcutsList: ReturnType<typeof vi.fn>

beforeEach(() => {
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    sessionNamePrompt: null,
    templatesDialogOpen: false,
    shortcutsDialogOpen: false,
    workspacesDialogOpen: false
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
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() =>
      Promise.resolve({
        version: 1,
        soundEnabled: true,
        terminalFontSize: 14,
        reminderCount: 3,
        reminderFirstDelayMinutes: 2
      })
    ),
    set: vi.fn(() =>
      Promise.resolve({
        version: 1,
        soundEnabled: true,
        terminalFontSize: 14,
        reminderCount: 3,
        reminderFirstDelayMinutes: 2
      })
    )
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  pickDirectory = vi.fn(() => Promise.resolve('/home/op/project'))
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory,
    launch: vi.fn(() => Promise.resolve({ terminalId: 'launch-term', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-term-tpl', workspaceId: 'default' })
    ),
    rename: vi.fn(() => Promise.resolve()),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
  }
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  shortcutsList = vi.fn(() => Promise.resolve([SC]))
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: shortcutsList,
    save: vi.fn(),
    remove: vi.fn()
  }
  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => shortcutsStore.getState().hydrate([]))
  vi.restoreAllMocks()
})

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush()
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

/** The header ☰ menu → Shortcuts…. */
function openShortcuts(r: RenderResult): void {
  click(q(r, '[data-testid="app-menu"]'))
  click(q(r, '[data-testid="app-menu-shortcuts"]'))
}

describe('App — shortcuts entry point', () => {
  it('loads the shortcuts once on mount and projects them into the store', async () => {
    await renderApp()
    expect(shortcutsList).toHaveBeenCalledTimes(1)
    expect(shortcutsStore.getState().shortcuts).toEqual([SC])
  })

  it('the header ☰ menu’s Shortcuts… opens the shortcuts dialog', async () => {
    const r = await renderApp()
    expect(r.container.querySelector('[data-testid="shortcuts-overlay"]')).toBeNull()
    openShortcuts(r)
    expect(q(r, '[data-testid="shortcuts-overlay"]')).toBeTruthy()
  })

  it('counts as a modal — Ctrl+N does NOT start a new session while it is open', async () => {
    const r = await renderApp()
    openShortcuts(r)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
    })
    await flush()
    expect(pickDirectory).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
  })

  // Workspaces (Task 10, UX-DR14 fault injection) — the Manage-workspaces dialog is renderer
  // view-state (boardStore.workspacesDialogOpen), so it is opened directly rather than via a UI
  // click (this file does not stub window.workspaces). Adapted from the brief's suggested
  // `fireEvent.keyDown(window, ...)` (from @testing-library/react, not installed — Story 1.3) to
  // this file's own native-dispatch-inside-act idiom, matching the sibling test above exactly.
  it('does not fire an app shortcut while the workspaces dialog is open', async () => {
    await renderApp()
    act(() => {
      boardStore.getState().openWorkspacesDialog()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
    })
    await flush()
    expect(pickDirectory).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
  })

  it('✕ closes the dialog', async () => {
    const r = await renderApp()
    openShortcuts(r)
    click(q(r, '[data-testid="shortcuts-close"]'))
    expect(r.container.querySelector('[data-testid="shortcuts-overlay"]')).toBeNull()
  })

  it('Escape from the page body closes the dialog', async () => {
    const r = await renderApp()
    openShortcuts(r)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(r.container.querySelector('[data-testid="shortcuts-overlay"]')).toBeNull()
  })
})
