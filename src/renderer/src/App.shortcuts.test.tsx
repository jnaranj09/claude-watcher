// Phrase shortcuts — App-level integration tests for the entry point.
//
// Covers: the `⌨` header button opens the ShortcutsDialog; the dialog counts as a MODAL
// (UX-DR14 single-modal rule refuses Ctrl+N while it is open); ✕ closes it; Escape from the
// page body closes it; and loadShortcuts() runs once on mount beside loadTemplates().
// Fake window bridges from the shared App harness (test/appHarness.ts), no Electron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { click, flush, q, unmountRendered, type RenderResult } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges } from './test/appHarness'
import { boardStore } from './stores/boardStore'
import { shortcutsStore } from './stores/shortcutsStore'
import type { Shortcut } from '../../shared/ipc/contract'

const SC: Shortcut = {
  id: 'sc-1',
  name: 'approve',
  alias: 'ap',
  text: 'I explicitly approve',
  workspaceId: null,
  favorite: false
}

let pickDirectory: ReturnType<typeof vi.fn>
let shortcutsList: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetBoardView()
  pickDirectory = vi.fn(() => Promise.resolve('/home/op/project'))
  shortcutsList = vi.fn(() => Promise.resolve([SC]))
  stubAppBridges({ launch: { pickDirectory }, shortcuts: { list: shortcutsList } })
})

afterEach(() => {
  unmountRendered()
  act(() => shortcutsStore.getState().hydrate([]))
  vi.restoreAllMocks()
})

/** The header ☰ menu → Shortcuts. */
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

  it('the header ☰ menu’s Shortcuts opens the shortcuts dialog', async () => {
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
    await flush(3)
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
    await flush(3)
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
