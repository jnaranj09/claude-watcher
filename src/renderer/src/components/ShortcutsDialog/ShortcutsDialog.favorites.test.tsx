// Favorites in the Shortcuts Manage dialog (spec 2026-10-13-favorites) — mirrors
// TemplatesDialog.favorites.test.tsx: the two Manage dialogs behave the same.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { settingsStore } from '../../stores/settingsStore'
import { q, renderComponent, type RenderResult } from '../../test/renderComponent'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import type { Shortcut, Workspace } from '../../../../shared/ipc/contract'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }

// Main's alias order. Own: a, b (pinned). Global: c (pinned), d.
const row = (id: string, workspaceId: string | null, favorite: boolean): Shortcut => ({
  id,
  name: id,
  alias: id,
  text: 'x',
  workspaceId,
  favorite
})
const ROWS: Shortcut[] = [
  row('a', 'w1', false),
  row('b', 'w1', true),
  row('c', null, true),
  row('d', null, false)
]

let cleanup: (() => void) | undefined
let setFavorite: ReturnType<typeof vi.fn>

beforeEach(() => {
  settingsStore.getState().applyPatch({ includeGlobal: true })
  setFavorite = vi.fn((id: string, favorite: boolean) =>
    Promise.resolve(ROWS.map((s) => (s.id === id ? { ...s, favorite } : s)))
  )
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn(() => Promise.resolve([])),
    setFavorite
  }
  act(() => shortcutsStore.setState({ shortcuts: ROWS, loaded: true }))
  act(() =>
    workspacesStore.setState({
      activeId: 'w1',
      workspaces: [
        { id: DEFAULT_WORKSPACE_ID, name: 'Default', color: 'slate', defaultCwd: null },
        W1
      ],
      loaded: true
    })
  )
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => shortcutsStore.setState({ shortcuts: [], loaded: false }))
  act(() =>
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  )
  settingsStore.getState().applyPatch({ includeGlobal: false })
  vi.restoreAllMocks()
})

function render(): RenderResult {
  const r = renderComponent(<ShortcutsDialog onClose={vi.fn()} />)
  cleanup = r.unmount
  return r
}

const ids = (r: RenderResult): string[] =>
  [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')].map((e) =>
    (e.getAttribute('data-testid') ?? '').replace('shortcut-row-', '')
  )

async function press(el: Element): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ShortcutsDialog — favorites', () => {
  it('pinned rows come first inside each group', () => {
    expect(ids(render())).toEqual(['b', 'a', 'c', 'd'])
  })
  it('every row shows its pin, pressed or not', () => {
    const r = render()
    expect(q(r, '[data-testid="shortcut-favorite-a"]').getAttribute('aria-pressed')).toBe('false')
    expect(q(r, '[data-testid="shortcut-favorite-b"]').getAttribute('aria-pressed')).toBe('true')
  })
  it('the pin toggles through the bridge and the row moves up', async () => {
    const r = render()
    await press(q(r, '[data-testid="shortcut-favorite-a"]'))
    expect(setFavorite).toHaveBeenCalledWith('a', true)
    expect(ids(r)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('clicking the pin does not open the row', async () => {
    const r = render()
    await press(q(r, '[data-testid="shortcut-favorite-a"]'))
    expect(r.container.querySelector('[data-testid="shortcut-placeholder"]')).not.toBeNull()
  })
  it('a refused pin shows the store copy in the message slot and keeps the pin', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setFavorite.mockImplementation(() =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: store_write_failed"))
    )
    const r = render()
    await press(q(r, '[data-testid="shortcut-favorite-a"]'))
    expect(q(r, '[data-testid="shortcuts-error"]').textContent).toBe(STORE_WRITE_FAILED_COPY)
    expect(q(r, '[data-testid="shortcut-favorite-a"]').getAttribute('aria-pressed')).toBe('false')
  })
})
