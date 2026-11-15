// TagMenu — the ONE drawing of a tag list popup (2026-09-29). The board filter's tag list and the
// card / rail TagPicker used to be two looks: chips on the filter, bare text + native checkboxes
// on the picker. Both now render TagMenu + TagMenuRow, so a theme styling one styles both.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent } from '../../test/renderComponent'
import { FilterBar } from '../FilterBar/FilterBar'
import { TagPicker } from '../TagPicker/TagPicker'
import { tagsStore } from '../../stores/tagsStore'
import { boardStore } from '../../stores/boardStore'
import { NO_FILTERS } from '../../lib/sessionFilters'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Tag } from '../../../../shared/ipc/contract'

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  act(() => {
    tagsStore.setState({ tags: [], loaded: false })
    boardStore.setState({ filtersByWorkspace: {} })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
  })
})

function renderFilterList(): Element {
  act(() => {
    workspacesStore.setState({
      workspaces: [{ id: 'default', name: 'Default', color: 'slate', defaultCwd: null }],
      activeId: 'default',
      loaded: true
    })
    tagsStore.setState({ tags: [DEPLOY, PROD], loaded: true })
    boardStore.getState().setBoardFilters('default', { ...NO_FILTERS, tagIds: ['t-prod'] })
  })
  const r = renderComponent(<FilterBar total={5} workspaceTotal={5} onManageTags={vi.fn()} />)
  cleanups.push(r.unmount)
  act(() => r.container.querySelector<HTMLElement>('[data-testid="filter-toggle"]')?.click())
  act(() => r.container.querySelector<HTMLElement>('[data-testid="filter-pill-tag-edit"]')?.click())
  return r.container
}

/** The picker's list is portaled to document.body: its root is the wrapper around its Surface. */
function renderPicker(): Element {
  const r = renderComponent(
    <TagPicker
      tags={[DEPLOY, PROD]}
      selectedIds={['t-prod']}
      onChange={vi.fn()}
      onClose={vi.fn()}
      anchorRef={{ current: null }}
      triggerRef={{ current: null }}
      testId="picker"
      label="Tags for api"
    />
  )
  cleanups.push(r.unmount)
  const root = document.querySelector('[data-testid="picker"]')?.parentElement
  if (root === null || root === undefined) throw new Error('picker not drawn')
  return root
}

describe('the filter tag list and the tag picker are ONE design', () => {
  it('both popups are TagMenu, and every row is a TagMenuRow holding a chip', () => {
    for (const r of [renderFilterList(), renderPicker()]) {
      const menus = r.querySelectorAll('[data-popover]')
      expect(menus).toHaveLength(1)
      const rows = [...(menus[0]?.querySelectorAll('[data-popover-item]') ?? [])]
      expect(rows).toHaveLength(2)
      for (const row of rows) expect(row.querySelector('[data-testid="tag-chip"]')).not.toBeNull()
    }
  })

  it('no longer stamps the retired one-off hooks', () => {
    for (const r of [renderFilterList(), renderPicker()]) {
      expect(r.querySelector('[data-tag-menu]')).toBeNull()
      expect(r.querySelector('[data-tag-menu-row]')).toBeNull()
    }
  })

  it('the chosen row carries the same check mark in both', () => {
    for (const r of [renderFilterList(), renderPicker()]) {
      const checks = r.querySelectorAll('[data-popover-item] [data-testid="tag-menu-check"]')
      expect(checks).toHaveLength(1)
      expect(checks[0]?.closest('[data-popover-item]')?.getAttribute('aria-checked')).toBe('true')
    }
  })

  // The look lives in TagMenu.module.css ONLY: a copy in either caller's module is how the two
  // drifted apart in the first place.
  it('neither caller declares a popup or row look of its own', () => {
    const dir = join(process.cwd(), 'src/renderer/src/components')
    for (const file of [
      'FilterBar/FilterBar.module.css',
      'FilterChips/FilterChips.module.css',
      'TagPicker/TagPicker.module.css'
    ]) {
      if (!existsSync(join(dir, file))) continue // no stylesheet at all declares nothing
      const css = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css, file).not.toMatch(/(^|[\s,])\.(menu|row|picker|checkbox)\s*[{,:[]/m)
    }
  })
})
