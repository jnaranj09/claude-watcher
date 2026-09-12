// Tags — the Manage-tags dialog (spec §4.4). jsdom `unit` project; `renderComponent` harness and
// `selectHarness` for the Select dropdowns, like TemplatesDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption } from '../../test/selectHarness'
import { TagsDialog } from './TagsDialog'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Tag, TagSaveRequest, Workspace } from '../../../../shared/ipc/contract'

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
  const r = renderComponent(<TagsDialog onClose={onClose} />)
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
  [...r.container.querySelectorAll('[data-testid="tag-row"]')].map((row) => row.textContent ?? '')

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

  it('a confirmed delete removes the row and returns to the empty form', async () => {
    const { r } = render()
    chooseOption(r.container, 'tag-scope-filter', 'all')
    click(q(r, '[data-testid="tag-select-t-deploy"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    click(q(r, '[data-testid="tag-delete"]'))
    await flush()
    expect(rowNames(r)).toEqual(['ops-only'])
    expect(q<HTMLInputElement>(r, '[data-testid="tag-name"]').value).toBe('')
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
