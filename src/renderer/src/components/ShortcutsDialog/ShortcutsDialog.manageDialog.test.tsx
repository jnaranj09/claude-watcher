// ShortcutsDialog on the shared ManageDialog shell — the two behaviour changes the migration
// brings for free (Phase-0 plan, docs/superpowers/plans/2026-09-12-tags-phase-0-manage-dialog.md):
//
// P0-2: the "which editor is open" state becomes the shell's `selectedId`. Before this migration
// `ShortcutEditor` was not remounted on `startEdit` (no `key`), so an armed `Confirm delete`
// followed the operator from one shortcut to the next.
// P0-3: Shortcuts' Delete had no Escape handling of its own, so Escape on an armed Delete bubbled
// to the dialog's own Escape handler and closed the WHOLE dialog (against design.md's "Escape
// peels one layer"). The shared `ManageDialog.Delete` fixes this for free.
//
// A separate file, not an edit to ShortcutsDialog.test.tsx: that suite is the unchanged safety net
// for the refactor (global-constraints.md) and must never be touched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'

const A = {
  id: 'sc-1',
  name: 'approve',
  keys: ['Ctrl+Alt+A'],
  text: 'I explicitly approve',
  workspaceId: null
}
const B = {
  id: 'sc-2',
  name: 'deny',
  keys: ['Ctrl+Alt+B'],
  text: 'I explicitly deny',
  workspaceId: null
}

let cleanup: (() => void) | undefined

beforeEach(() => {
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([A, B])),
    save: vi.fn(() => Promise.resolve({ saved: A, shortcuts: [A, B] })),
    remove: vi.fn(() => Promise.resolve([B]))
  }
  shortcutsStore.setState({ shortcuts: [A, B], loaded: true })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => shortcutsStore.getState().hydrate([]))
  act(() =>
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  )
  vi.restoreAllMocks()
})

function render(onClose: () => void = () => {}): RenderResult {
  const r = renderComponent(<ShortcutsDialog onClose={onClose} />)
  cleanup = r.unmount
  return r
}

function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`)
}

function click(el: Element | null): void {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function key(el: Element | null, k: string): void {
  act(() => {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

describe('ShortcutsDialog — opening another editor disarms Delete (P0-2)', () => {
  it('arming Delete on one shortcut, then editing another, leaves the new editor unarmed', () => {
    render()
    click(byTestId('shortcut-edit-sc-1'))
    click(byTestId('shortcut-delete'))
    expect(byTestId('shortcut-delete')?.textContent).toBe('Confirm delete')

    click(byTestId('shortcut-edit-sc-2'))
    expect(byTestId('shortcut-delete')?.textContent).toBe('Delete')
  })
})

describe('ShortcutsDialog — Escape on an armed Delete disarms instead of closing (P0-3)', () => {
  it('does not close the dialog, and disarms the button', () => {
    const onClose = vi.fn()
    render(onClose)
    click(byTestId('shortcut-edit-sc-1'))
    click(byTestId('shortcut-delete'))
    expect(byTestId('shortcut-delete')?.textContent).toBe('Confirm delete')

    key(byTestId('shortcut-delete'), 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(byTestId('shortcut-delete')?.textContent).toBe('Delete')
  })
})
