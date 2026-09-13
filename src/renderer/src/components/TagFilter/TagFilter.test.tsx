// Tags — the header tag filter (spec §4.3). jsdom `unit` project.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { TagFilter } from './TagFilter'
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

function render(onManageTags: () => void = vi.fn()): RenderResult {
  const r = renderComponent(<TagFilter onManageTags={onManageTags} />)
  cleanup = r.unmount
  return r
}

const button = (r: RenderResult): HTMLButtonElement => {
  const el = r.container.querySelector<HTMLButtonElement>('[data-testid="tag-filter"]')
  if (el === null) throw new Error('missing tag-filter')
  return el
}
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())
const rowIds = (r: RenderResult): (string | null)[] =>
  [...r.container.querySelectorAll('[role="menu"] [role="menuitemradio"]')].map((el) =>
    el.getAttribute('data-testid')
  )

describe('TagFilter', () => {
  it('says All tags until a tag is chosen, then shows that tag as a chip', () => {
    const r = render()
    expect(button(r).textContent).toContain('All tags')
    expect(button(r).getAttribute('aria-label')).toBe('Tag filter: All tags')
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    expect(button(r).querySelector('[data-testid="tag-chip"]')?.textContent).toBe('prod')
    expect(button(r).getAttribute('aria-label')).toBe('Tag filter: prod')
  })

  it('lists All tags, then the global tags, then this workspace’s own — never another workspace’s', () => {
    const r = render()
    click(button(r))
    expect(rowIds(r)).toEqual([
      'tag-filter-all',
      'tag-filter-row-t-deploy',
      'tag-filter-row-t-prod'
    ])
    click(button(r))
    act(() => workspacesStore.setState({ activeId: 'wa' }))
    click(button(r))
    expect(rowIds(r)).toEqual([
      'tag-filter-all',
      'tag-filter-row-t-deploy',
      'tag-filter-row-t-prod',
      'tag-filter-row-t-ops'
    ])
  })

  it('picking a tag sets the filter and closes the menu; All tags clears it', () => {
    const r = render()
    click(button(r))
    click(r.container.querySelector('[data-testid="tag-filter-row-t-prod"]'))
    expect(tagsStore.getState().activeTagId).toBe('t-prod')
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
    click(button(r))
    expect(
      r.container
        .querySelector('[data-testid="tag-filter-row-t-prod"]')
        ?.getAttribute('aria-checked')
    ).toBe('true')
    click(r.container.querySelector('[data-testid="tag-filter-all"]'))
    expect(tagsStore.getState().activeTagId).toBeNull()
  })

  it('Manage tags… closes the menu and calls onManageTags', () => {
    const onManageTags = vi.fn()
    const r = render(onManageTags)
    click(button(r))
    click(r.container.querySelector('[data-testid="tag-filter-manage-tags"]'))
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
  })

  it('Escape closes the menu and puts focus back on the button', () => {
    const r = render()
    click(button(r))
    const menu = r.container.querySelector('[role="menu"]')
    if (menu === null) throw new Error('menu did not open')
    fireEvent(menu, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(button(r))
  })

  it('switching to a workspace that cannot see the chosen tag clears the filter (spec §4.1)', () => {
    act(() => workspacesStore.setState({ activeId: 'wa' }))
    render()
    act(() => tagsStore.getState().setActiveTag('t-ops'))
    act(() => workspacesStore.setState({ activeId: 'default' }))
    expect(tagsStore.getState().activeTagId).toBeNull()
  })

  it('Manage rules… is offered when wired, closes the menu and calls onManageRules', () => {
    const onManageRules = vi.fn()
    const r = renderComponent(<TagFilter onManageTags={vi.fn()} onManageRules={onManageRules} />)
    cleanup = r.unmount
    click(button(r))
    click(r.container.querySelector('[data-testid="tag-filter-manage-rules"]'))
    expect(onManageRules).toHaveBeenCalledTimes(1)
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
  })

  it('offers no Manage rules… row when nobody handles it', () => {
    const r = render()
    click(button(r))
    expect(r.container.querySelector('[data-testid="tag-filter-manage-rules"]')).toBeNull()
  })
})
