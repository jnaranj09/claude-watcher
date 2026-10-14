// Favorites in the Templates Manage dialog (spec 2026-10-13-favorites): a pin on every row,
// pinned rows first inside each group, a refused pin in the dialog's message slot.
// Harness mirrors TemplatesDialog.scope.test.tsx (renderComponent, no Testing Library).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { settingsStore } from '../../stores/settingsStore'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { SessionsDialog } from '../SessionsDialog/SessionsDialog'
import { templatesStore } from '../../stores/templatesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import type { Template, Workspace } from '../../../../shared/ipc/contract'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }

const base = {
  cwd: '/c',
  model: null,
  permissionMode: null,
  effort: null,
  initialPrompt: null,
  params: []
}
// Main's A-Z order. Own: a, b (pinned). Global: c (pinned), d.
const ROWS: Template[] = [
  { ...base, id: 'a', name: 'a', workspaceId: 'w1', favorite: false },
  { ...base, id: 'b', name: 'b', workspaceId: 'w1', favorite: true },
  { ...base, id: 'c', name: 'c', workspaceId: null, favorite: true },
  { ...base, id: 'd', name: 'd', workspaceId: null, favorite: false }
]

let cleanup: (() => void) | undefined
let setFavorite: ReturnType<typeof vi.fn>

beforeEach(() => {
  settingsStore.getState().applyPatch({ includeGlobal: true })
  setFavorite = vi.fn((id: string, favorite: boolean) =>
    Promise.resolve(ROWS.map((t) => (t.id === id ? { ...t, favorite } : t)))
  )
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn(() => Promise.resolve([])),
    setFavorite
  }
  act(() => templatesStore.getState().hydrate(ROWS))
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
  act(() => templatesStore.getState().hydrate([]))
  act(() =>
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  )
  settingsStore.getState().applyPatch({ includeGlobal: false })
  vi.restoreAllMocks()
})

function render(): RenderResult {
  const r = renderComponent(
    <SessionsDialog page="templates" onPageChange={() => {}} onClose={vi.fn()} />
  )
  cleanup = r.unmount
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const ids = (r: RenderResult): (string | null)[] =>
  [...r.container.querySelectorAll('[data-template-id]')].map((e) =>
    e.getAttribute('data-template-id')
  )

async function press(el: Element): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('TemplatesDialog — favorites', () => {
  it('pinned rows come first inside each group', () => {
    expect(ids(render())).toEqual(['b', 'a', 'c', 'd'])
  })
  it('every row shows its pin, pressed or not', () => {
    const r = render()
    expect(q(r, '[data-testid="template-favorite-a"]').getAttribute('aria-pressed')).toBe('false')
    expect(q(r, '[data-testid="template-favorite-b"]').getAttribute('aria-pressed')).toBe('true')
  })
  it('the pin toggles through the bridge and the row moves up', async () => {
    const r = render()
    await press(q(r, '[data-testid="template-favorite-a"]'))
    expect(setFavorite).toHaveBeenCalledWith('a', true)
    expect(ids(r)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('clicking the pin does not open the row', async () => {
    const r = render()
    await press(q(r, '[data-testid="template-favorite-a"]'))
    expect(r.container.querySelector('[data-testid="template-placeholder"]')).not.toBeNull()
  })
  it('a refused pin shows the store copy in the message slot and keeps the pin', async () => {
    setFavorite.mockImplementation(() =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: store_write_failed"))
    )
    const r = render()
    await press(q(r, '[data-testid="template-favorite-a"]'))
    expect(q(r, '[data-testid="template-error"]').textContent).toBe(STORE_WRITE_FAILED_COPY)
    expect(q(r, '[data-testid="template-favorite-a"]').getAttribute('aria-pressed')).toBe('false')
  })
})
