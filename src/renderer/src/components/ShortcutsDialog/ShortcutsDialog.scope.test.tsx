// The Manage dialog's header scope filter — the Shortcuts half. The two Manage dialogs must
// behave identically here, so these cases mirror TemplatesDialog.scope.test.tsx.
//
// Every case seeds a NON-EMPTY workspaces store: with it empty the dialog falls back to
// the `all` entry, which is the state the sibling test file already covers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionLabel, optionValues, selectedValue } from '../../test/selectHarness'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import type { Shortcut, Workspace } from '../../../../shared/ipc/contract'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
const DEFAULT_WS: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  color: 'slate',
  defaultCwd: null
}

const GLOBAL: Shortcut = {
  id: 'g',
  name: 'global-one',
  keys: ['Ctrl+Alt+A'],
  text: 'g',
  workspaceId: null
}
const OWN: Shortcut = {
  id: 'own',
  name: 'ops-one',
  keys: ['Ctrl+Alt+B'],
  text: 'o',
  workspaceId: 'w1'
}
const ORPHAN: Shortcut = {
  id: 'orphan',
  name: 'stranded-one',
  keys: ['Ctrl+Alt+C'],
  text: 's',
  workspaceId: 'gone'
}

let cleanup: (() => void) | undefined

beforeEach(() => {
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(() => Promise.resolve({ saved: OWN, shortcuts: [OWN] })),
    remove: vi.fn(() => Promise.resolve([]))
  }
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

function seed(shortcuts: Shortcut[], activeId = 'w1'): void {
  act(() => shortcutsStore.setState({ shortcuts, loaded: true }))
  act(() => workspacesStore.setState({ activeId, workspaces: [DEFAULT_WS, W1], loaded: true }))
}

function render(): RenderResult {
  const r = renderComponent(<ShortcutsDialog onClose={vi.fn()} />)
  cleanup = r.unmount
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

function ids(r: RenderResult): string[] {
  return [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')]
    .map((el) => el.getAttribute('data-testid') ?? '')
    .filter((id) => id !== 'shortcut-row-editing')
}

const FILTER = 'shortcut-scope-filter'

const click = (el: Element): void => act(() => (el as HTMLElement).click())

describe('ShortcutsDialog scope filter', () => {
  // Same words as the Templates dialog's own entry, with the dialog's own noun — see the sibling
  // test for why it is not `All workspaces`.
  it('names the unfiltered entry after the list, not the workspaces', () => {
    seed([GLOBAL, OWN])
    const r = render()
    expect(optionLabel(r.container, FILTER, 'all')).toBe('All shortcuts')
  })

  it('opens on the active workspace and lists only its rows', () => {
    seed([GLOBAL, OWN])
    const r = render()
    expect(selectedValue(r.container, FILTER)).toBe('ws:w1')
    expect(ids(r)).toEqual(['shortcut-row-own'])
  })

  it('falls back to All when the active id names no known workspace', () => {
    seed([GLOBAL, OWN], 'vanished')
    const r = render()
    expect(selectedValue(r.container, FILTER)).toBe('all')
    expect(ids(r).sort()).toEqual(['shortcut-row-g', 'shortcut-row-own'])
  })

  it('shows every row under All', () => {
    seed([GLOBAL, OWN])
    const r = render()
    chooseOption(r.container, FILTER, 'all')
    expect(ids(r).sort()).toEqual(['shortcut-row-g', 'shortcut-row-own'])
  })

  it('narrows to Global', () => {
    seed([GLOBAL, OWN])
    const r = render()
    chooseOption(r.container, FILTER, 'global')
    expect(ids(r)).toEqual(['shortcut-row-g'])
  })

  // Flat in EVERY scope, All included — same rule as the templates rail. Structural, not an
  // absent-testid check: ONE rowgroup holding every row is what a sectioned list cannot produce,
  // and it is also the a11y shape (table > rowgroup > row) that must survive.
  it('never renders scope sections — one rowgroup holds every row', () => {
    seed([GLOBAL, OWN])
    const r = render()
    chooseOption(r.container, FILTER, 'all')
    const groups = r.container.querySelectorAll('[role="rowgroup"]')
    expect(groups).toHaveLength(1)
    const rows = [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')]
    expect(rows).toHaveLength(2)
    expect(groups[0]?.children).toHaveLength(rows.length)
  })

  it('offers (no workspace) only when a row has a gone workspace', () => {
    seed([GLOBAL, OWN])
    const r = render()
    expect(optionValues(r.container, FILTER)).not.toContain('orphans')
    cleanup?.()
    cleanup = undefined

    seed([GLOBAL, OWN, ORPHAN])
    const r2 = render()
    expect(optionValues(r2.container, FILTER)).toContain('orphans')
  })

  // The editor card is the shortcuts dialog's equivalent of the templates form: it must not
  // outlive the list it was opened from.
  it('closes the open editor when the scope changes', () => {
    seed([GLOBAL, OWN])
    const r = render()
    click(q(r, '[data-testid="shortcut-edit-own"]'))
    expect(r.container.querySelector('[data-testid="shortcut-row-editing"]')).not.toBeNull()
    chooseOption(r.container, FILTER, 'global')
    expect(r.container.querySelector('[data-testid="shortcut-row-editing"]')).toBeNull()
  })
})
