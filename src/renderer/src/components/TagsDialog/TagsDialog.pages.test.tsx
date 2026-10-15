// Tags · Rules (spec 2026-10-03 C): one Tags dialog, two pages, the scope kept across them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useState, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, selectedValue } from '../../test/selectHarness'
import { TagsDialog } from './TagsDialog'
import type { TagsDialogPage } from '../../stores/boardStore'
import { rulesStore } from '../../stores/rulesStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
let cleanup: (() => void) | undefined
beforeEach(() => {
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [], loaded: true, loadFailed: false, activeTagId: null })
    rulesStore.setState({ rules: [], brokenIds: [], loaded: true, loadFailed: false })
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

function Harness({ initial }: { initial: TagsDialogPage }): JSX.Element {
  const [page, setPage] = useState<TagsDialogPage>(initial)
  return <TagsDialog page={page} onPageChange={setPage} onClose={() => {}} />
}
function render(initial: TagsDialogPage): RenderResult {
  const r = renderComponent(<Harness initial={initial} />)
  cleanup = r.unmount
  return r
}
const q = (r: RenderResult, sel: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(sel)

describe('TagsDialog — Tags · Rules pages', () => {
  it('one dialog titled Tags; the asked-for page is current', () => {
    const r = render('rules')
    expect(q(r, '[data-testid="tags-overlay"]')?.getAttribute('aria-label')).toBe('Tags')
    expect(q(r, '[data-testid="tags-page-rules"]')?.getAttribute('aria-current')).toBe('page')
    expect(q(r, '[data-testid="rule-new"]')).not.toBeNull()
  })

  it('switching to Tags keeps the scope', () => {
    const r = render('rules')
    chooseOption(r.container, 'rule-scope-filter', 'global')
    act(() => q(r, '[data-testid="tags-page-tags"]')?.click())
    expect(q(r, '[data-testid="tag-new"]')).not.toBeNull()
    expect(selectedValue(r.container, 'tag-scope-filter')).toBe('global')
  })
})

describe('TagsDialog — a page switch closes what was open (final review 4a)', () => {
  it('+ New on Tags, then Rules: the Rules page shows its placeholder, never an empty form', () => {
    const r = render('tags')
    act(() => q(r, '[data-testid="tag-new"]')?.click())
    expect(r.container.querySelector('[data-testid="tag-name"]')).not.toBeNull()
    act(() => q(r, '[data-testid="tags-page-rules"]')?.click())
    expect(q(r, '[data-testid="rule-placeholder"]')).not.toBeNull()
  })
})
