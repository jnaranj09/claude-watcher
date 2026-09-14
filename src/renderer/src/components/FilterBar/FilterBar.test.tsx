// The board's filter bar (2026-09-14, design option C): the active filter as a removable pill, and
// `+ Add filter`. Tag is the only filter type today, so `+ Add filter` opens the tag list directly.
// It starts COLLAPSED to a small `Filters` toggle, so it costs the board less height until it is
// used. jsdom `unit` project.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { FilterBar, type FilterBarProps } from './FilterBar'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
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

/** The bar as it first draws: collapsed to its `Filters` toggle. */
function render(props: Partial<FilterBarProps> = {}): RenderResult {
  const r = renderComponent(
    <FilterBar total={5} workspaceTotal={5} onManageTags={vi.fn()} {...props} />
  )
  cleanup = r.unmount
  return r
}

/** The bar with its toggle clicked open. */
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

  it('starts collapsed: a labelled group holding only the Filters toggle', () => {
    const r = render()
    const bar = q(r, 'filter-bar')
    expect(bar?.getAttribute('role')).toBe('group')
    expect(bar?.getAttribute('aria-label')).toBe('Filters')
    const toggle = q(r, 'filter-toggle')
    // An icon, not the word: an uppercase FILTERS label read badly.
    expect(toggle?.textContent).toBe('')
    expect(toggle?.querySelector('svg')?.getAttribute('width')).toBe('16')
    expect(toggle?.getAttribute('aria-label')).toBe('Filters')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.getAttribute('data-filter-on')).toBe('false')
    expect(toggle?.getAttribute('title')).toBe('Show filters')
    expect(q(r, 'filter-add')).toBeNull()
    expect(q(r, 'filter-count')).toBeNull()
    expect(q(r, 'filter-toggle-count')).toBeNull()
  })

  it('the toggle shows the filter controls, and hides them again', () => {
    const r = render()
    const toggle = q(r, 'filter-toggle')
    click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(toggle?.getAttribute('title')).toBe('Hide filters')
    // getElementById: a React id is not a valid CSS selector.
    const controls = document.getElementById(toggle?.getAttribute('aria-controls') ?? '')
    expect(controls?.contains(q(r, 'filter-add'))).toBe(true)
    expect(q(r, 'filter-count')?.textContent).toBe('5 sessions')
    click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(q(r, 'filter-add')).toBeNull()
  })

  // Collapsed, the pill is out of sight while cards are still hidden — the toggle has to say so.
  it('collapsed with a filter on, the toggle says one filter is on', () => {
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    const r = render()
    const toggle = q(r, 'filter-toggle')
    expect(q(r, 'filter-pill-tag')).toBeNull()
    expect(q(r, 'filter-toggle-count')?.textContent).toBe('1')
    expect(toggle?.getAttribute('aria-label')).toBe('Filters, 1 on')
    // It lights up: the loudest state, so hidden cards are hard to forget.
    expect(toggle?.getAttribute('data-filter-on')).toBe('true')
    click(toggle)
    expect(q(r, 'filter-pill-tag')).not.toBeNull()
    expect(q(r, 'filter-toggle-count')).toBeNull()
    expect(toggle?.getAttribute('data-filter-on')).toBe('false')
    expect(toggle?.getAttribute('aria-label')).toBe('Filters')
  })

  // The toggle is the header ☰ button's box (AppMenu `.button`): 26px tall, a 16px icon, the same
  // border. Open reads as PRESSED, so it draws no chevron. jsdom has no layout: read the stylesheet.
  it('the toggle is the ☰ button’s box, draws no chevron, and lights up only through data-filter-on', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/FilterBar/FilterBar.module.css'),
      'utf8'
    )
    const toggle = /\n\.toggle \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(toggle).toMatch(/height: 26px;/)
    expect(toggle).toMatch(/border: 1px solid var\(--border\);/)
    expect(toggle).toMatch(/border-radius: var\(--rounded-md\);/)
    expect(css).not.toMatch(/\.toggle::after/)
    expect(css).toMatch(
      /\.toggle\[data-filter-on='true'\] \{[^}]*background: var\(--text-primary\);/
    )
  })

  it('collapsing closes an open tag list', () => {
    const r = renderOpen()
    click(q(r, 'filter-add'))
    expect(menu(r)).not.toBeNull()
    click(q(r, 'filter-toggle'))
    click(q(r, 'filter-toggle'))
    expect(menu(r)).toBeNull()
  })

  it('opened with no filter: + Add filter and the session count', () => {
    const r = renderOpen({ total: 5, workspaceTotal: 5 })
    expect(q(r, 'filter-add')?.textContent).toBe('+ Add filter')
    expect(q(r, 'filter-add')?.getAttribute('aria-expanded')).toBe('false')
    expect(q(r, 'filter-pill-tag')).toBeNull()
    expect(q(r, 'filter-count')?.textContent).toBe('5 sessions')
  })

  it('counts one session in the singular', () => {
    const r = renderOpen({ total: 1, workspaceTotal: 1 })
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
    expect(q(r, 'filter-count')?.textContent).toBe('3 shown · 2 hidden by the filter')
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

  it('with no tags yet, + Add filter offers Create tags…, which opens tag management', () => {
    act(() => tagsStore.setState({ tags: [] }))
    const onManageTags = vi.fn()
    const r = renderOpen({ onManageTags })
    click(q(r, 'filter-add'))
    expect(q(r, 'filter-no-tags')?.textContent).toBe('No tags yet')
    click(q(r, 'filter-create-tags'))
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(menu(r)).toBeNull()
  })

  it('with no tags and no way to create one, renders nothing', () => {
    act(() => tagsStore.setState({ tags: [] }))
    const r = renderComponent(<FilterBar total={5} workspaceTotal={5} />)
    cleanup = r.unmount
    expect(q(r, 'filter-bar')).toBeNull()
  })

  it('switching to a workspace that cannot see the chosen tag clears the filter (spec §4.1)', () => {
    act(() => workspacesStore.setState({ activeId: 'wa' }))
    render()
    act(() => tagsStore.getState().setActiveTag('t-ops'))
    act(() => workspacesStore.setState({ activeId: 'default' }))
    expect(tagsStore.getState().activeTagId).toBeNull()
  })
})
