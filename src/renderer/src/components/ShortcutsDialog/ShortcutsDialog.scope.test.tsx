// The Manage dialog's header scope filter — the Shortcuts half. The two Manage dialogs must
// behave identically here, so these cases mirror TemplatesDialog.scope.test.tsx.
//
// Every case seeds a NON-EMPTY workspaces store: with it empty the dialog falls back to
// the `all` entry, which is the state the sibling test file already covers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { settingsStore } from '../../stores/settingsStore'
import { stubSettings } from '../../test/settingsBridge'
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
  alias: 'ga',
  text: 'g',
  workspaceId: null,
  favorite: false
}
const OWN: Shortcut = {
  id: 'own',
  name: 'ops-one',
  alias: 'ow',
  text: 'o',
  workspaceId: 'w1',
  favorite: false
}
const ORPHAN: Shortcut = {
  id: 'orphan',
  name: 'stranded-one',
  alias: 'or',
  text: 's',
  workspaceId: 'gone',
  favorite: false
}

let cleanup: (() => void) | undefined

beforeEach(() => {
  // The strict tests below read the UNCHECKED behaviour; the Include global test turns it on.
  settingsStore.getState().applyPatch({ includeGlobal: false })
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
  return [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')].map(
    (el) => el.getAttribute('data-testid') ?? ''
  )
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
  // absent-testid check: ONE parent holding every row, and nothing else, is what a sectioned list
  // cannot produce.
  it('never renders scope sections — one list holds every row', () => {
    seed([GLOBAL, OWN])
    const r = render()
    chooseOption(r.container, FILTER, 'all')
    const rows = [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')]
    expect(rows).toHaveLength(2)
    const parent = rows[0]?.parentElement
    expect(rows.every((row) => row.parentElement === parent)).toBe(true)
    expect(parent?.children).toHaveLength(rows.length)
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

  // The form must not outlive the list it was opened from: nothing open, the placeholder.
  it('closes the open form when the scope changes', () => {
    seed([GLOBAL, OWN])
    const r = render()
    click(q(r, '[data-testid="shortcut-select-own"]'))
    expect(r.container.querySelector('[data-testid="shortcut-form"]')).not.toBeNull()
    chooseOption(r.container, FILTER, 'global')
    expect(r.container.querySelector('[data-testid="shortcut-form"]')).toBeNull()
    expect(q(r, '[data-testid="shortcut-placeholder"]')).toBeTruthy()
  })

  // R7 — three empty states, three sentences (design.md). With shortcuts saved but none in the
  // scope the dialog opened on, a bare table header read as a broken list.
  it('says the workspace has no shortcuts when the scope is empty', () => {
    seed([GLOBAL])
    const r = render()
    expect(q(r, '[data-testid="shortcuts-empty-scope"]').textContent).toBe(
      'No shortcuts in this workspace'
    )
    expect(r.container.querySelector('[data-testid="shortcuts-empty"]')).toBeNull()
    expect(r.container.querySelector('[role="table"]')).toBeNull()
  })

  it('says there are no global shortcuts when Global is empty', () => {
    seed([OWN])
    const r = render()
    chooseOption(r.container, FILTER, 'global')
    expect(q(r, '[data-testid="shortcuts-empty-scope"]').textContent).toBe('No global shortcuts')
  })

  // Editing the scope's only row keeps it in the rail — the scope is not empty.
  it('does not call the scope empty while its only row is open', () => {
    seed([GLOBAL, OWN])
    const r = render()
    click(q(r, '[data-testid="shortcut-select-own"]'))
    expect(r.container.querySelector('[data-testid="shortcuts-empty-scope"]')).toBeNull()
  })
})

describe('a save that moves the row follows it (Review Focus 5)', () => {
  it('keeps the row selected and re-points the filter at its new scope', async () => {
    seed([OWN])
    const moved: Shortcut = { ...OWN, workspaceId: null }
    ;(window as unknown as { shortcuts: { save: unknown } }).shortcuts.save = vi.fn(() =>
      Promise.resolve({ saved: moved, shortcuts: [moved] })
    )
    const r = render()
    click(q(r, '[data-testid="shortcut-select-own"]'))
    chooseOption(r.container, 'shortcut-scope', 'global')
    click(q(r, '[data-testid="shortcut-save"]'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(selectedValue(r.container, FILTER)).toBe('global')
    expect(q(r, '[data-testid="shortcut-row-own"]').getAttribute('data-selected')).toBe('true')
  })
})

describe('where each row lives (spec 2026-10-03 H)', () => {
  it('every row carries a marker', () => {
    seed([GLOBAL, OWN])
    const r = render()
    chooseOption(r.container, FILTER, 'all')
    const rows = [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')]
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(row.querySelector('[data-testid="scope-marker"]')).not.toBeNull()
  })
})

describe('Include global (spec 2026-10-03 H)', () => {
  it('on: the workspace rows, then the global ones; off: own rows only', async () => {
    stubSettings()
    act(() => settingsStore.getState().applyPatch({ includeGlobal: true }))
    seed([GLOBAL, OWN])
    const r = render()
    const ids = (): (string | null | undefined)[] =>
      [...r.container.querySelectorAll('[data-testid^="shortcut-row-"]')].map((e) =>
        e.getAttribute('data-testid')?.replace('shortcut-row-', '')
      )
    expect(ids()).toEqual(['own', 'g'])
    await act(async () => {
      r.container
        .querySelector<HTMLInputElement>('[data-testid="shortcut-include-global"]')
        ?.click()
      await Promise.resolve()
    })
    expect(ids()).toEqual(['own'])
  })
})
