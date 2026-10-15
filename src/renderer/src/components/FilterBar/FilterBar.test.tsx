// The board's filter bar: a controls row (the search box, the `Filter` button, the count) and,
// under it once the button is pressed, the chip row — the active filter as a removable pill, and
// `+ Add filter`. Tag is the only filter type today, so `+ Add filter` opens the tag list directly.
// jsdom `unit` project.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { FilterBar, type FilterBarProps } from './FilterBar'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { boardStore } from '../../stores/boardStore'
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
    tagsStore.setState({ tags: [DEPLOY, OPS, PROD], loaded: true, activeTagId: null })
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => {
    tagsStore.setState({ tags: [], loaded: false, activeTagId: null })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    boardStore.setState({ searchQuery: '' })
  })
})

const q = (r: RenderResult, testId: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())
const menu = (r: RenderResult): Element | null => r.container.querySelector('[role="menu"]')
const rowIds = (r: RenderResult): (string | null)[] =>
  [...r.container.querySelectorAll('[role="menu"] [role="menuitemradio"]')].map((el) =>
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
    act(() => tagsStore.getState().setActiveTag('t-prod'))
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

  it('closing the chip row closes an open tag list', () => {
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

  it('+ Add filter opens the tag list directly: global tags, then this workspace’s own, never another’s', () => {
    const r = renderOpen()
    click(q(r, 'filter-add'))
    expect(q(r, 'filter-add')?.getAttribute('aria-expanded')).toBe('true')
    expect(rowIds(r)).toEqual(['filter-tag-row-t-deploy', 'filter-tag-row-t-prod'])
    click(q(r, 'filter-add'))
    act(() => workspacesStore.setState({ activeId: 'wa' }))
    click(q(r, 'filter-add'))
    expect(rowIds(r)).toEqual([
      'filter-tag-row-t-deploy',
      'filter-tag-row-t-prod',
      'filter-tag-row-t-ops'
    ])
  })

  it('picking a tag sets the filter, closes the list and shows the filter as a pill', () => {
    const r = renderOpen({ total: 3, workspaceTotal: 5 })
    click(q(r, 'filter-add'))
    click(q(r, 'filter-tag-row-t-prod'))
    expect(tagsStore.getState().activeTagId).toBe('t-prod')
    expect(menu(r)).toBeNull()
    const pill = q(r, 'filter-pill-tag')
    expect(pill?.textContent).toContain('Tag is')
    expect(pill?.querySelector('[data-testid="tag-chip"]')?.textContent).toBe('prod')
    // One tag at a time: while it is on, the pill is where it changes — no second Add.
    expect(q(r, 'filter-add')).toBeNull()
    expect(q(r, 'filter-count')?.textContent).toBe('3 shown · 2 hidden')
    expect(document.activeElement).toBe(q(r, 'filter-pill-tag-edit'))
  })

  it('clicking the pill reopens the list on the current tag; picking another switches it', () => {
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    const r = renderOpen()
    const edit = q(r, 'filter-pill-tag-edit')
    expect(edit?.getAttribute('aria-label')).toBe('Tag filter: prod. Change it')
    click(edit)
    expect(q(r, 'filter-tag-row-t-prod')?.getAttribute('aria-checked')).toBe('true')
    click(q(r, 'filter-tag-row-t-deploy'))
    expect(tagsStore.getState().activeTagId).toBe('t-deploy')
  })

  it('× removes the filter and puts focus on + Add filter', () => {
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    const r = renderOpen()
    const remove = q(r, 'filter-pill-tag-remove')
    expect(remove?.getAttribute('aria-label')).toBe('Remove the tag filter')
    click(remove)
    expect(tagsStore.getState().activeTagId).toBeNull()
    expect(q(r, 'filter-pill-tag')).toBeNull()
    expect(document.activeElement).toBe(q(r, 'filter-add'))
  })

  it('Escape closes the list, stops there, and puts focus back on its trigger', () => {
    const r = renderOpen()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    click(q(r, 'filter-add'))
    const list = menu(r)
    if (list === null) throw new Error('list did not open')
    fireEvent(list, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.removeEventListener('keydown', outer)
    expect(menu(r)).toBeNull()
    expect(outer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(q(r, 'filter-add'))
  })

  it('a mousedown outside closes the list', () => {
    const r = renderOpen()
    click(q(r, 'filter-add'))
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu(r)).toBeNull()
  })

  it('with no tags yet, + Add filter offers Create tags, which opens tag management', () => {
    act(() => tagsStore.setState({ tags: [] }))
    const onManageTags = vi.fn()
    const r = renderOpen({ onManageTags })
    click(q(r, 'filter-add'))
    expect(q(r, 'filter-no-tags')?.textContent).toBe('No tags yet')
    click(q(r, 'filter-create-tags'))
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(menu(r)).toBeNull()
  })

  // A control that opens onto nothing is not rendered — but the search box still has a job.
  it('with no tags and no way to create one: the search box, and no Filter button', () => {
    act(() => tagsStore.setState({ tags: [] }))
    const r = renderComponent(<FilterBar total={5} workspaceTotal={5} />)
    cleanup = r.unmount
    expect(q(r, 'filter-bar')).not.toBeNull()
    expect(searchBox(r)).not.toBeNull()
    expect(q(r, 'filter-toggle')).toBeNull()
  })

  it('switching to a workspace that cannot see the chosen tag clears the filter (spec §4.1)', () => {
    act(() => workspacesStore.setState({ activeId: 'wa' }))
    render()
    act(() => tagsStore.getState().setActiveTag('t-ops'))
    act(() => workspacesStore.setState({ activeId: 'default' }))
    expect(tagsStore.getState().activeTagId).toBeNull()
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
