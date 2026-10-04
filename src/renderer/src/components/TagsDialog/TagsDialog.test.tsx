// Tags — the Manage-tags dialog (spec §4.4). jsdom `unit` project; `renderComponent` harness and
// `selectHarness` for the Select dropdowns, like TemplatesDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { rowText } from '../../test/rowText'
import { settingsStore } from '../../stores/settingsStore'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption } from '../../test/selectHarness'
import { TagsDialog } from './TagsDialog'
import { tagsStore } from '../../stores/tagsStore'
import { rulesStore } from '../../stores/rulesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Tag, TagSaveRequest, Workspace, Rule } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const OPS: Tag = { id: 't-ops', name: 'ops-only', color: 'blue', workspaceId: 'w1' }

let cleanup: (() => void) | undefined
let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>

beforeEach(() => {
  // These tests read the strict (unchecked) list; Include global has its own tests.
  settingsStore.getState().applyPatch({ includeGlobal: false })
  save = vi.fn((req: TagSaveRequest) => {
    const saved: Tag = {
      id: req.id ?? 't-new',
      name: req.name,
      color: req.color,
      workspaceId: req.workspaceId
    }
    return Promise.resolve({ saved, tags: [DEPLOY, OPS, saved] })
  })
  remove = vi.fn(() => Promise.resolve([OPS]))
  ;(window as unknown as { tags: unknown }).tags = { list: vi.fn(), save, remove }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'default', loaded: true })
    tagsStore.setState({ tags: [DEPLOY, OPS], loaded: true, activeTagId: null })
  })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => {
    tagsStore.setState({ tags: [], loaded: false, activeTagId: null })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    rulesStore.setState({ rules: [], brokenIds: [], loaded: false })
  })
  vi.restoreAllMocks()
})

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function render(): { r: RenderResult; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const r = renderComponent(<TagsDialog page="tags" onPageChange={() => {}} onClose={onClose} />)
  cleanup = r.unmount
  return { r, onClose }
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())
const rowNames = (r: RenderResult): string[] =>
  [...r.container.querySelectorAll('[data-testid="tag-row"]')].map(rowText)

describe('TagsDialog', () => {
  it('opens on the active workspace — its own tags only (strict scope); All tags shows every row', () => {
    const { r } = render()
    expect(rowNames(r)).toEqual([])
    expect(q(r, '[data-testid="tags-empty"]').textContent).toBe('No tags in this workspace')
    chooseOption(r.container, 'tag-scope-filter', 'all')
    expect(rowNames(r)).toEqual(['deploy', 'ops-only'])
  })

  it('creates a global tag from the form and follows it into the Global scope', async () => {
    const { r } = render()
    click(q(r, '[data-testid="tag-new"]'))
    type(q(r, '[data-testid="tag-name"]'), 'prod')
    chooseOption(r.container, 'tag-color', 'rose')
    click(q(r, '[data-testid="tag-save"]'))
    await flush()
    expect(save).toHaveBeenCalledWith({ name: 'prod', color: 'rose', workspaceId: null })
    // A new row is Global; the list was on Default, so the scope follows the saved row.
    expect(rowNames(r)).toContain('prod')
    expect(q(r, '[data-testid="tags-success"]').textContent).toBe('Tag saved.')
  })

  it('shows the operator copy when the name is taken (the wrapped Electron error)', async () => {
    save.mockRejectedValueOnce(
      new Error("Error invoking remote method 'tags:save': Error: tag_name_taken")
    )
    const { r } = render()
    click(q(r, '[data-testid="tag-new"]'))
    type(q(r, '[data-testid="tag-name"]'), 'deploy')
    click(q(r, '[data-testid="tag-save"]'))
    await flush()
    expect(q(r, '[data-testid="tag-error"]').textContent).toMatch(/already exists/i)
  })

  it('a refused delete (a rule uses the tag) says so and keeps the row', async () => {
    remove.mockRejectedValueOnce(
      new Error("Error invoking remote method 'tags:delete': Error: tag_in_use")
    )
    const { r } = render()
    chooseOption(r.container, 'tag-scope-filter', 'all')
    click(q(r, '[data-testid="tag-select-t-deploy"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    await flush()
    expect(remove).toHaveBeenCalledWith('t-deploy')
    expect(q(r, '[data-testid="tag-error"]').textContent).toMatch(/rule/i)
    expect(rowNames(r)).toContain('deploy')
  })

  // R26 / spec 2026-10-01 — editing ANY field ends the message: Color and Workspace too, not only Name.
  it('changing Color or Workspace after a save clears "Tag saved."', async () => {
    const { r } = render()
    click(q(r, '[data-testid="tag-new"]'))
    type(q(r, '[data-testid="tag-name"]'), 'prod')
    click(q(r, '[data-testid="tag-save"]'))
    await flush()
    expect(q(r, '[data-testid="tags-success"]').textContent).toBe('Tag saved.')
    chooseOption(r.container, 'tag-color', 'rose')
    expect(r.container.querySelector('[data-testid="tags-success"]')).toBeNull()
    click(q(r, '[data-testid="tag-save"]'))
    await flush()
    expect(q(r, '[data-testid="tags-success"]').textContent).toBe('Tag saved.')
    chooseOption(r.container, 'tag-scope', 'w1')
    expect(r.container.querySelector('[data-testid="tags-success"]')).toBeNull()
  })

  it('a confirmed delete removes the row and returns to the placeholder', async () => {
    const { r } = render()
    chooseOption(r.container, 'tag-scope-filter', 'all')
    click(q(r, '[data-testid="tag-select-t-deploy"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    await flush()
    expect(rowNames(r)).toEqual(['ops-only'])
    expect(q(r, '[data-testid="tag-placeholder"]')).toBeTruthy()
    expect(r.container.querySelector('[data-testid="tag-name"]')).toBeNull()
    expect(q(r, '[data-testid="tags-success"]').textContent).toBe('Tag deleted.')
  })

  it('a refused delete says how many rules use the tag (T-16)', async () => {
    const uses: Rule = {
      id: 'r1',
      name: 'r',
      workspaceId: null,
      trigger: { kind: 'launched' },
      conditions: [],
      actions: [{ kind: 'add-tag', tagId: 't-deploy' }]
    }
    act(() =>
      rulesStore.getState().hydrate({ rules: [uses, { ...uses, id: 'r2' }], brokenIds: [] })
    )
    remove.mockRejectedValueOnce(
      new Error("Error invoking remote method 'tags:delete': Error: tag_in_use")
    )
    const { r } = render()
    chooseOption(r.container, 'tag-scope-filter', 'all')
    click(q(r, '[data-testid="tag-select-t-deploy"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    await flush()
    expect(q(r, '[data-testid="tag-error"]').textContent).toBe(
      'Used by 2 rules. Change or delete them first.'
    )
  })

  it('D-13: a slash name draws as parent/ muted + leaf, indented, and its row is named by the full name', () => {
    act(() => {
      tagsStore.setState({
        tags: [
          { id: 't-acme', name: 'acme', color: 'blue', workspaceId: null },
          { id: 't-acme-prod', name: 'acme/prod', color: 'blue', workspaceId: null }
        ],
        loaded: true,
        activeTagId: null
      })
    })
    const { r } = render()
    // Both seeded tags are global (workspaceId: null); the dialog opens on the active workspace's
    // OWN scope (strict filtering — design.md), so switch to Global to see them.
    chooseOption(r.container, 'tag-scope-filter', 'global')
    // Target the row by its own stable id, not row position — `tag-row` is shared by every row.
    const child = r.container.querySelector<HTMLElement>(
      '[data-testid="tag-select-t-acme-prod"] [data-testid="tag-path"]'
    )
    expect(child?.getAttribute('aria-label')).toBe('acme/prod')
    expect(child?.querySelector('[data-testid="tag-path-parent"]')?.textContent).toBe('acme/')
    expect(child?.style.paddingLeft).toBe('calc(1 * var(--space-3))')
  })

  it('closes on Escape', () => {
    const { r, onClose } = render()
    act(() => {
      q(r, '[data-testid="tags-overlay"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('nothing open → placeholder (spec 2026-09-29)', () => {
  it('opens on the placeholder, with no form field rendered', () => {
    const { r } = render()
    expect(q(r, '[data-testid="tag-placeholder"]').textContent).toBe(
      'Select a tag on the left, or create a new one.'
    )
    expect(r.container.querySelector('#tag-name')).toBeNull()
  })

  it('+ New replaces the placeholder with the empty form', () => {
    const { r } = render()
    click(q(r, '[data-testid="tag-new"]'))
    expect(r.container.querySelector('[data-testid="tag-placeholder"]')).toBeNull()
    expect(r.container.querySelector('#tag-name')).not.toBeNull()
  })

  it('picking a row replaces the placeholder with that row', () => {
    const { r } = render()
    chooseOption(r.container, 'tag-scope-filter', 'all')
    click(q(r, '[data-testid="tag-select-t-deploy"]'))
    expect(r.container.querySelector('[data-testid="tag-placeholder"]')).toBeNull()
    expect(r.container.querySelector('#tag-name')).not.toBeNull()
  })
})

describe('where each row lives (spec 2026-10-03 H)', () => {
  it('every row carries a marker', () => {
    const { r } = render()
    chooseOption(r.container, 'tag-scope-filter', 'all')
    const rows = [...r.container.querySelectorAll('[data-testid="tag-row"]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.querySelector('[data-testid="scope-marker"]')).not.toBeNull()
  })
})
