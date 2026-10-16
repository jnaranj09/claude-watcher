// The board's filter bar: a controls row (the search box, the `Filter` button, the count) and,
// under it once the button is pressed, the chip row (`FilterChips`). The lists' own mechanics are
// FilterChips' tests; these cover the board's side: filters kept per workspace, what the chip row
// is offered, and the button's count. jsdom `unit` project.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { FilterBar, type FilterBarProps } from './FilterBar'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { boardStore, selectBoardFilters } from '../../stores/boardStore'
import { NO_FILTERS } from '../../lib/sessionFilters'
import { watchUpdated } from '../../../../__fixtures__/watchEvents'
import type { Tag, Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'wa', name: 'Ops', color: 'blue', defaultCwd: null }
]
// The catalog's own order (main sorts by name): deploy, ops-only, prod.
const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const OPS: Tag = { id: 't-ops', name: 'ops-only', color: 'blue', workspaceId: 'wa' }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

let cleanup: (() => void) | undefined
beforeEach(() => {
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'default', loaded: true })
    tagsStore.setState({ tags: [DEPLOY, OPS, PROD], loaded: true })
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => {
    tagsStore.setState({ tags: [], loaded: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    boardStore.setState({ searchQuery: '', filtersByWorkspace: {}, sessionsById: {} })
  })
})

const q = (r: RenderResult, testId: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())
const menu = (r: RenderResult): Element | null => r.container.querySelector('[role="menu"]')
const checkboxRowIds = (r: RenderResult): (string | null)[] =>
  [...r.container.querySelectorAll('[role="menuitemcheckbox"]')].map((el) =>
    el.getAttribute('data-testid')
  )
const searchBox = (r: RenderResult): HTMLInputElement => {
  const el = r.container.querySelector<HTMLInputElement>('[data-testid="board-search"]')
  if (el === null) throw new Error('missing search box')
  return el
}
/** Type into the search box the way the DOM does, so React's onChange fires. */
function type(el: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The bar as it first draws: the controls row only. */
function render(props: Partial<FilterBarProps> = {}): RenderResult {
  const r = renderComponent(
    <FilterBar total={5} workspaceTotal={5} onManageTags={vi.fn()} {...props} />
  )
  cleanup = r.unmount
  return r
}

/** The bar with its `Filter` button pressed: the chip row is showing. */
function renderOpen(props: Partial<FilterBarProps> = {}): RenderResult {
  const r = render(props)
  click(q(r, 'filter-toggle'))
  return r
}

describe('FilterBar', () => {
  it('renders nothing while the workspace has no sessions', () => {
    const r = render({ total: 0, workspaceTotal: 0 })
    expect(q(r, 'filter-bar')).toBeNull()
  })

  it('first draws only the controls row: the search box, the Filter button and the count', () => {
    const r = render()
    const bar = q(r, 'filter-bar')
    expect(bar?.getAttribute('role')).toBe('group')
    expect(bar?.getAttribute('aria-label')).toBe('Search and filters')
    const row = q(r, 'filter-controls-row')
    expect(row?.contains(searchBox(r))).toBe(true)
    expect(searchBox(r).placeholder).toBe('Search…')
    expect(searchBox(r).getAttribute('aria-label')).toBe('Search sessions')
    const toggle = q(r, 'filter-toggle')
    expect(row?.contains(toggle)).toBe(true)
    // The icon AND the word: the mockup's `Filter` button.
    expect(toggle?.textContent).toBe('Filter')
    expect(toggle?.querySelector('svg')?.getAttribute('width')).toBe('16')
    expect(toggle?.getAttribute('aria-label')).toBe('Filter')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.hasAttribute('data-lit')).toBe(false)
    expect(toggle?.getAttribute('title')).toBe('Show filters')
    // The count sits on the controls row, so it shows even with the chip row closed.
    expect(row?.contains(q(r, 'filter-count'))).toBe(true)
    expect(q(r, 'filter-count')?.textContent).toBe('5 sessions')
    expect(q(r, 'filter-add')).toBeNull()
    expect(q(r, 'filter-toggle-count')).toBeNull()
  })

  it('the Filter button shows the chip row BELOW the controls row, and hides it again', () => {
    const r = render()
    const toggle = q(r, 'filter-toggle')
    click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(toggle?.getAttribute('title')).toBe('Hide filters')
    // Open is LIT, like the rail's open tag toggles — with or without a filter on.
    expect(toggle?.hasAttribute('data-lit')).toBe(true)
    // getElementById: a React id is not a valid CSS selector.
    const chips = document.getElementById(toggle?.getAttribute('aria-controls') ?? '')
    expect(chips?.contains(q(r, 'filter-add'))).toBe(true)
    const row = q(r, 'filter-controls-row')
    expect(row?.contains(chips ?? null)).toBe(false)
    if (row === null || chips === null) throw new Error('missing a row')
    expect(row.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.hasAttribute('data-lit')).toBe(false)
    expect(q(r, 'filter-add')).toBeNull()
  })

  // With the chip row closed, the pill is out of sight while cards are still hidden — the button has
  // to say so, loudly. Opening the row must not put the light out: it stays lit while open.
  it('with a filter on, the button carries the count and stays lit, chip row closed or open', () => {
    act(() =>
      boardStore.getState().setBoardFilters('default', { ...NO_FILTERS, tagIds: [PROD.id] })
    )
    const r = render()
    const toggle = q(r, 'filter-toggle')
    expect(q(r, 'filter-pill-tag')).toBeNull()
    expect(q(r, 'filter-toggle-count')?.textContent).toBe('1')
    expect(toggle?.getAttribute('aria-label')).toBe('Filter, 1 on')
    expect(toggle?.hasAttribute('data-lit')).toBe(true)
    click(toggle)
    expect(q(r, 'filter-pill-tag')).not.toBeNull()
    expect(q(r, 'filter-toggle-count')?.textContent).toBe('1')
    expect(toggle?.hasAttribute('data-lit')).toBe(true)
  })

  // The button is `Button` (secondary, md) — the toolbar's height, 32px, the same as the search box
  // beside it (TextInput's `toolbar` variant). Open reads as LIT through Button's `data-lit`, so it
  // draws no chevron and no separate "pressed" look, or open would have two looks. jsdom has no
  // layout: read the stylesheets. FilterBar's own module must no longer draw the button (the
  // `.toggle` copy is what Button replaced).
  it('the Filter button is the search box’s height, draws no chevron, and lights up only through data-lit', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/FilterBar/FilterBar.module.css'),
      'utf8'
    )
    const button = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Button/Button.module.css'),
      'utf8'
    )
    const field = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/TextInput/TextInput.module.css'),
      'utf8'
    )
    const box = /\n\.button \{([^}]*)\}/.exec(button)?.[1] ?? ''
    expect(box).toMatch(/height: 32px;/)
    expect(/\n\.toolbar \{([^}]*)\}/.exec(field)?.[1] ?? '').toMatch(/height: 32px;/)
    expect(box).toMatch(/border-radius: var\(--rounded-md\);/)
    expect(button).toMatch(/\.button\[data-lit\] \{[^}]*background: var\(--text-primary\);/)
    expect(button).not.toMatch(
      /\[aria-expanded='true'\][^{]*\{[^}]*background: var\(--text-primary\)/
    )
    expect(css).not.toMatch(/\.toggle\b/)
    expect(css).not.toMatch(/data-lit/)
    const r = render()
    expect(q(r, 'filter-toggle')?.getAttribute('data-variant')).toBe('secondary')
    expect(q(r, 'filter-toggle')?.getAttribute('data-size')).toBe('md')
  })

  it('closing the chip row closes an open list', () => {
    const r = renderOpen()
    click(q(r, 'filter-add'))
    expect(menu(r)).not.toBeNull()
    click(q(r, 'filter-toggle'))
    click(q(r, 'filter-toggle'))
    expect(menu(r)).toBeNull()
  })

  it('opened with no filter: + Add filter', () => {
    const r = renderOpen()
    expect(q(r, 'filter-add')?.textContent).toBe('+ Add filter')
    expect(q(r, 'filter-add')?.getAttribute('aria-expanded')).toBe('false')
    expect(q(r, 'filter-pill-tag')).toBeNull()
  })

  it('counts one session in the singular', () => {
    const r = render({ total: 1, workspaceTotal: 1 })
    expect(q(r, 'filter-count')?.textContent).toBe('1 session')
  })

  it('a filter set here is kept per workspace: switching away hides it, switching back restores it', () => {
    act(() =>
      boardStore.getState().setBoardFilters('default', {
        ...NO_FILTERS,
        tagIds: [PROD.id],
        launched: { kind: 'preset', range: 'today' }
      })
    )
    const r = render()
    expect(q(r, 'filter-toggle')?.getAttribute('aria-label')).toBe('Filter, 2 on')
    act(() => workspacesStore.setState({ activeId: 'wa' }))
    expect(q(r, 'filter-toggle')?.getAttribute('aria-label')).toBe('Filter')
    act(() => workspacesStore.setState({ activeId: 'default' }))
    expect(q(r, 'filter-toggle')?.getAttribute('aria-label')).toBe('Filter, 2 on')
  })

  it('a tag this workspace cannot see does not count and shows no pill', () => {
    act(() => boardStore.getState().setBoardFilters('default', { ...NO_FILTERS, tagIds: [OPS.id] }))
    const r = render()
    expect(q(r, 'filter-toggle')?.getAttribute('aria-label')).toBe('Filter')
    click(q(r, 'filter-toggle'))
    expect(q(r, 'filter-pill-tag')).toBeNull()
  })

  it('the chip row offers this workspace’s folders, never another’s, and a pick is stored for it', () => {
    act(() => {
      const apply = boardStore.getState().applyWatchEvent
      apply(watchUpdated(1, 'one', 'idle', 1, { projectPath: '/p/one' }))
      apply(watchUpdated(1, 'two', 'idle', 1, { projectPath: '/p/two' }))
      apply(watchUpdated(1, 'ops', 'idle', 1, { projectPath: '/p/ops', workspaceId: 'wa' }))
    })
    const r = render({ workspaceTotal: 2 })
    click(q(r, 'filter-toggle'))
    click(q(r, 'filter-add'))
    click(q(r, 'filter-type-folder'))
    expect(checkboxRowIds(r)).toEqual(['filter-folder-row-/p/one', 'filter-folder-row-/p/two'])
    click(q(r, 'filter-folder-row-/p/one'))
    expect(selectBoardFilters(boardStore.getState(), 'default').folders).toEqual(['/p/one'])
    expect(selectBoardFilters(boardStore.getState(), 'wa')).toBe(NO_FILTERS)
  })

  it('with no tags yet, the tag list offers Create tags, which opens tag management', () => {
    act(() => tagsStore.setState({ tags: [] }))
    const onManageTags = vi.fn()
    const r = renderOpen({ onManageTags })
    click(q(r, 'filter-add'))
    click(q(r, 'filter-type-tag'))
    expect(q(r, 'filter-no-tags')?.textContent).toBe('No tags yet')
    click(q(r, 'filter-create-tags'))
    expect(onManageTags).toHaveBeenCalledTimes(1)
  })

  // Folder and time need no tag, so the button shows even with no tag and no way to make one.
  it('with no tags and no way to create one: the search box AND the Filter button', () => {
    act(() => tagsStore.setState({ tags: [] }))
    const r = renderComponent(<FilterBar total={5} workspaceTotal={5} />)
    cleanup = r.unmount
    expect(searchBox(r)).not.toBeNull()
    expect(q(r, 'filter-toggle')).not.toBeNull()
  })
})

describe('FilterBar — the search box', () => {
  it('typing sets the board’s search, as typed', () => {
    const r = render()
    type(searchBox(r), 'Dep')
    expect(boardStore.getState().searchQuery).toBe('Dep')
  })

  it('shows the current search', () => {
    act(() => boardStore.getState().setSearchQuery('abc'))
    const r = render()
    expect(searchBox(r).value).toBe('abc')
  })

  it('a search counts as hiding: the count says how many are shown', () => {
    act(() => boardStore.getState().setSearchQuery('x'))
    const r = render({ total: 2, workspaceTotal: 5 })
    expect(q(r, 'filter-count')?.textContent).toBe('2 shown · 3 hidden')
  })

  it('a blank search hides nothing, so the count stays plain', () => {
    act(() => boardStore.getState().setSearchQuery('   '))
    const r = render()
    expect(q(r, 'filter-count')?.textContent).toBe('5 sessions')
  })

  // The box already says what it holds; the number counts only what is out of sight in the chip row.
  it('the search is not counted on the Filter button', () => {
    act(() => boardStore.getState().setSearchQuery('x'))
    const r = render()
    expect(q(r, 'filter-toggle-count')).toBeNull()
    expect(q(r, 'filter-toggle')?.hasAttribute('data-lit')).toBe(false)
  })

  // Escape peels ONE layer: the search text, and it must not also reach App's Escape (Focused → Board).
  it('Escape in a box holding text clears it and stops there', () => {
    act(() => boardStore.getState().setSearchQuery('dep'))
    const r = render()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    fireEvent(searchBox(r), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.removeEventListener('keydown', outer)
    expect(boardStore.getState().searchQuery).toBe('')
    expect(outer).not.toHaveBeenCalled()
  })

  it('Escape in an empty box passes through', () => {
    const r = render()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    fireEvent(searchBox(r), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.removeEventListener('keydown', outer)
    expect(outer).toHaveBeenCalledTimes(1)
  })
})

describe('FilterBar — public theme hooks', () => {
  it('marks the session count for themes', () => {
    const r = render()
    const count = r.container.querySelector('[data-session-count]')
    expect(count?.getAttribute('data-count')).toBe('total')
  })
})
