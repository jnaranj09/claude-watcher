// The Manage dialog's header scope filter. Harness: renderComponent + container.querySelector
// (this repo does not install @testing-library/react — Story 1.3), mirroring
// TemplatesDialog.test.tsx.
//
// Every case seeds a NON-EMPTY workspaces store. With the store empty the dialog falls back to
// the `all` entry and shows everything — which is what the pre-existing tests in the sibling
// file exercise, and why none of them noticed the filter arriving.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionLabel, optionValues, selectedValue } from '../../test/selectHarness'
import { TemplatesDialog } from './TemplatesDialog'
import { templatesStore } from '../../stores/templatesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import type { Template, Workspace } from '../../../../shared/ipc/contract'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
const DEFAULT_WS: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  color: 'slate',
  defaultCwd: null
}

const base = {
  cwd: '/c',
  model: null,
  permissionMode: null,
  effort: null,
  initialPrompt: null,
  params: []
}
const GLOBAL: Template = { ...base, id: 'g', name: 'global-one', workspaceId: null }
const OWN: Template = { ...base, id: 'own', name: 'ops-one', workspaceId: 'w1' }
const OTHER: Template = {
  ...base,
  id: 'other',
  name: 'default-one',
  workspaceId: DEFAULT_WORKSPACE_ID
}
const ORPHAN: Template = { ...base, id: 'orphan', name: 'stranded-one', workspaceId: 'gone' }

let cleanup: (() => void) | undefined
let save: ReturnType<typeof vi.fn>

beforeEach(() => {
  save = vi.fn((req: Template) => {
    const saved = { ...req, id: req.id ?? 'new' }
    return Promise.resolve({ saved, templates: [saved] })
  })
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save,
    remove: vi.fn(() => Promise.resolve([]))
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(null))
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => templatesStore.getState().hydrate([]))
  act(() =>
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  )
  vi.restoreAllMocks()
})

function seed(templates: Template[], activeId = 'w1'): void {
  act(() => templatesStore.getState().hydrate(templates))
  act(() => workspacesStore.setState({ activeId, workspaces: [DEFAULT_WS, W1], loaded: true }))
}

function render(): RenderResult {
  const r = renderComponent(<TemplatesDialog onClose={vi.fn()} />)
  cleanup = r.unmount
  return r
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

function names(r: RenderResult): string[] {
  return [...r.container.querySelectorAll('[data-testid="template-row"]')].map(
    (el) => el.textContent ?? ''
  )
}

const FILTER = 'template-scope-filter'

const click = (el: Element): void => act(() => (el as HTMLElement).click())

describe('TemplatesDialog scope filter', () => {
  // `All templates` names the LIST; `Global` names a property of a row and is a SUBSET of it.
  // Labelled `All workspaces`, the two read as siblings and an operator reasonably asks which of
  // the two shows everything.
  it('names the unfiltered entry after the list, not the workspaces', () => {
    seed([GLOBAL, OWN])
    const r = render()
    expect(optionLabel(r.container, FILTER, 'all')).toBe('All templates')
  })

  // The default that makes the dialog useful on open: the rows for the workspace you are in.
  // Global rows are NOT shown here — the filter is strict in both directions.
  it('opens on the active workspace and lists only its rows', () => {
    seed([GLOBAL, OWN, OTHER])
    const r = render()
    expect(selectedValue(r.container, FILTER)).toBe('ws:w1')
    expect(names(r)).toEqual(['ops-one'])
  })

  it('falls back to All when the active id names no known workspace', () => {
    seed([GLOBAL, OWN], 'vanished')
    const r = render()
    expect(selectedValue(r.container, FILTER)).toBe('all')
    expect(names(r).sort()).toEqual(['global-one', 'ops-one'])
  })

  // All is the ONE wide value — it keeps this dialog the single place every template is visible.
  it('shows every row under All', () => {
    seed([GLOBAL, OWN, OTHER])
    const r = render()
    chooseOption(r.container, FILTER, 'all')
    expect(names(r).sort()).toEqual(['default-one', 'global-one', 'ops-one'])
  })

  it('narrows to Global', () => {
    seed([GLOBAL, OWN, OTHER])
    const r = render()
    chooseOption(r.container, FILTER, 'global')
    expect(names(r)).toEqual(['global-one'])
  })

  // The list is flat in EVERY scope, All included: a section header would name the workspace the
  // form's own Workspace field already names, and cost the rail a third of its height.
  // Structural, not an absent-testid check: a re-introduced section would put a header element
  // (or a per-group wrapper) among the rows' siblings whatever it were named, so the row count
  // and the container's child count would stop matching.
  it('never renders scope sections — the rows are the list', () => {
    seed([GLOBAL, OWN, OTHER])
    const r = render()
    chooseOption(r.container, FILTER, 'all')
    const rows = [...r.container.querySelectorAll('[data-testid="template-row"]')]
    expect(rows).toHaveLength(3)
    const parent = rows[0]?.parentElement
    expect(parent).not.toBeNull()
    expect(parent?.children).toHaveLength(rows.length)
    for (const row of rows) expect(row.parentElement).toBe(parent)
  })

  // `(no workspace)` advertises a state that normally cannot happen, so it appears only when a
  // row is actually in it.
  it('offers (no workspace) only when a row has a gone workspace', () => {
    seed([GLOBAL, OWN])
    const r = render()
    expect(optionValues(r.container, FILTER)).not.toContain('orphans')
    cleanup?.()
    cleanup = undefined

    seed([GLOBAL, OWN, ORPHAN])
    const r2 = render()
    expect(optionValues(r2.container, FILTER)).toContain('orphans')
    chooseOption(r2.container, FILTER, 'orphans')
    expect(names(r2)).toEqual(['stranded-one'])
  })

  it('clears the selection when the scope changes', () => {
    seed([GLOBAL, OWN, OTHER])
    const r = render()
    click(q(r, '[data-template-id="own"]'))
    expect(q<HTMLInputElement>(r, '[data-testid="template-name"]').value).toBe('ops-one')
    chooseOption(r.container, FILTER, 'global')
    // Back to the empty New form — a row you can no longer see must not stay in the editor.
    expect(q<HTMLInputElement>(r, '[data-testid="template-name"]').value).toBe('')
  })

  // Saving a row into a DIFFERENT workspace moves it out of the view it was saved from. Without
  // this the row silently disappears and the save reads as a failure.
  it('follows a row that a save moves to another workspace', async () => {
    seed([OWN])
    const r = render()
    click(q(r, '[data-template-id="own"]'))
    chooseOption(r.container, 'template-scope', 'global')
    click(q(r, '[data-testid="template-save"]'))
    await flush()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: null }))
    expect(selectedValue(r.container, FILTER)).toBe('global')
    expect(names(r)).toEqual(['ops-one'])
  })
})
