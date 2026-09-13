import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionValues, selectedValue } from '../../test/selectHarness'
import { TemplatesDialog } from './TemplatesDialog'
import { templatesStore } from '../../stores/templatesStore'
import { rulesStore } from '../../stores/rulesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import type { Template, Rule } from '../../../../shared/ipc/contract'

const T1: Template = {
  id: 'a',
  name: 'api',
  cwd: '/home/op/api',
  model: 'opus',
  permissionMode: 'plan',
  effort: 'high',
  workspaceId: null
}

let cleanup: (() => void) | undefined
let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
let pickDirectory: ReturnType<typeof vi.fn>
beforeEach(() => {
  save = vi.fn((req: Template) =>
    Promise.resolve({ saved: { ...req, id: 'new' }, templates: [T1, { ...req, id: 'new' }] })
  )
  remove = vi.fn(() => Promise.resolve([]))
  pickDirectory = vi.fn(() => Promise.resolve('/home/op/blog'))
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([T1])),
    save,
    remove
  }
  ;(window as unknown as { launch: unknown }).launch = { pickDirectory }
  act(() => templatesStore.getState().hydrate([T1]))
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
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
function render(): { r: RenderResult; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const r = renderComponent(<TemplatesDialog onClose={onClose} />)
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

describe('TemplatesDialog', () => {
  it('opens on a NEW draft: Save disabled, no Delete, list shows the store rows', () => {
    const { r } = render()
    expect(r.container.querySelectorAll('[data-testid="template-row"]')).toHaveLength(1)
    expect(q<HTMLButtonElement>(r, '[data-testid="template-save"]').disabled).toBe(true)
    expect(r.container.querySelector('[data-testid="template-delete"]')).toBeNull()
  })
  it('Browse… fills the folder from pickDirectory; a cancelled picker changes nothing', async () => {
    const { r } = render()
    click(q(r, '[data-testid="template-browse"]'))
    await flush()
    expect(q(r, '[data-testid="template-cwd"]').textContent).toBe('/home/op/blog')
    pickDirectory.mockResolvedValueOnce(null)
    click(q(r, '[data-testid="template-browse"]'))
    await flush()
    expect(q(r, '[data-testid="template-cwd"]').textContent).toBe('/home/op/blog')
  })
  it('a valid new draft saves through window.templates.save with the custom model and mode', async () => {
    const { r } = render()
    type(q(r, '[data-testid="template-name"]'), 'blog')
    click(q(r, '[data-testid="template-browse"]'))
    await flush()
    chooseOption(r.container, 'template-model', 'custom')
    type(q(r, '[data-testid="template-model-custom"]'), 'claude-x')
    chooseOption(r.container, 'template-permission', 'acceptEdits')
    expect(q<HTMLButtonElement>(r, '[data-testid="template-save"]').disabled).toBe(false)
    click(q(r, '[data-testid="template-save"]'))
    await flush()
    expect(save).toHaveBeenCalledWith({
      name: 'blog',
      cwd: '/home/op/blog',
      model: 'claude-x',
      permissionMode: 'acceptEdits',
      effort: null,
      workspaceId: null
    })
    expect(r.container.querySelectorAll('[data-testid="template-row"]')).toHaveLength(2)
  })
  it('selecting a row loads it; the error copy shows when main says template_name_taken', async () => {
    const { r } = render()
    click(q(r, '[data-template-id="a"]'))
    expect(q<HTMLInputElement>(r, '[data-testid="template-name"]').value).toBe('api')
    expect(selectedValue(r.container, 'template-model')).toBe('opus')
    type(q(r, '[data-testid="template-name"]'), 'api2')
    save.mockRejectedValueOnce(new Error('template_name_taken'))
    click(q(r, '[data-testid="template-save"]'))
    await flush()
    expect(q(r, '[data-testid="template-error"]').textContent).toBe(
      'A template with this name already exists.'
    )
    expect(save).toHaveBeenCalledWith({
      id: 'a',
      name: 'api2',
      cwd: '/home/op/api',
      model: 'opus',
      permissionMode: 'plan',
      effort: 'high',
      workspaceId: null
    })
  })
  it('a chosen effort reaches window.templates.save; Default sends null', async () => {
    const { r } = render()
    type(q(r, '[data-testid="template-name"]'), 'blog')
    click(q(r, '[data-testid="template-browse"]'))
    await flush()
    chooseOption(r.container, 'template-effort', 'xhigh')
    click(q(r, '[data-testid="template-save"]'))
    await flush()
    expect(save).toHaveBeenCalledWith({
      name: 'blog',
      cwd: '/home/op/blog',
      model: null,
      permissionMode: null,
      effort: 'xhigh',
      workspaceId: null
    })
  })
  it('selecting a row preselects its effort, and changing only the effort enables Save', () => {
    const { r } = render()
    click(q(r, '[data-template-id="a"]'))
    expect(selectedValue(r.container, 'template-effort')).toBe('high')
    expect(q<HTMLButtonElement>(r, '[data-testid="template-save"]').disabled).toBe(true)
    chooseOption(r.container, 'template-effort', 'low')
    expect(q<HTMLButtonElement>(r, '[data-testid="template-save"]').disabled).toBe(false)
  })
  it('Delete is two-step: first click arms "Confirm delete", second removes and returns to a new draft', async () => {
    const { r } = render()
    click(q(r, '[data-template-id="a"]'))
    const del = q<HTMLButtonElement>(r, '[data-testid="template-delete"]')
    click(del)
    expect(remove).not.toHaveBeenCalled()
    expect(q(r, '[data-testid="template-delete"]').textContent).toBe('Confirm delete')
    click(q(r, '[data-testid="template-delete"]'))
    await flush()
    expect(remove).toHaveBeenCalledWith('a')
    expect(r.container.querySelector('[data-testid="template-delete"]')).toBeNull()
  })
  it('a dirty-but-invalid draft explains WHY Save is disabled; the hint clears when it is fixed', async () => {
    const { r } = render()
    expect(r.container.querySelector('[data-testid="template-hint"]')).toBeNull() // pristine
    type(q(r, '[data-testid="template-name"]'), 'blog')
    expect(q(r, '[data-testid="template-hint"]').textContent).toBe('Pick a folder.')
    click(q(r, '[data-testid="template-browse"]'))
    await flush()
    expect(r.container.querySelector('[data-testid="template-hint"]')).toBeNull()
    expect(q<HTMLButtonElement>(r, '[data-testid="template-save"]').disabled).toBe(false)
  })
  it('Escape while "Confirm delete" is armed disarms ONLY — the dialog stays open', () => {
    const { r, onClose } = render()
    click(q(r, '[data-template-id="a"]'))
    click(q(r, '[data-testid="template-delete"]'))
    expect(q(r, '[data-testid="template-delete"]').textContent).toBe('Confirm delete')
    act(() => {
      q(r, '[data-testid="template-delete"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(r.container.querySelector('[data-testid="templates-overlay"]')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(q(r, '[data-testid="template-delete"]').textContent).toBe('Delete')
    // Disarmed now — a SECOND Escape falls through to the dialog and closes it.
    act(() => {
      q(r, '[data-testid="template-delete"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('search filters the list; ✕ and Escape call onClose', () => {
    const { r, onClose } = render()
    type(q(r, '[data-testid="template-search"]'), 'zzz')
    expect(r.container.querySelectorAll('[data-testid="template-row"]')).toHaveLength(0)
    click(q(r, '[data-testid="templates-close"]'))
    act(() => {
      q(r, '[data-testid="templates-overlay"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // --- Task 11: scope control + orphan grouping ---------------------------------------------
  it('saves the scope chosen in the form', async () => {
    act(() =>
      workspacesStore.setState({
        activeId: 'w1',
        workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
        loaded: true
      })
    )
    const { r } = render()
    type(q(r, '[data-testid="template-name"]'), 'blog')
    click(q(r, '[data-testid="template-browse"]'))
    await flush()
    chooseOption(r.container, 'template-scope', 'w1')
    click(q(r, '[data-testid="template-save"]'))
    await flush()
    expect(save).toHaveBeenCalledWith({
      name: 'blog',
      cwd: '/home/op/blog',
      model: null,
      permissionMode: null,
      effort: null,
      workspaceId: 'w1'
    })
  })

  it('keeps a row whose workspace is gone reachable', () => {
    act(() => workspacesStore.setState({ activeId: 'w1', workspaces: [], loaded: true }))
    act(() =>
      templatesStore.setState({
        templates: [
          {
            id: 't1',
            name: 'Orphan',
            cwd: '/p',
            model: null,
            permissionMode: null,
            effort: null,
            workspaceId: 'gone'
          }
        ],
        loaded: true
      })
    )
    const { r } = render()
    // The list has no scope sections any more — a row whose workspace is gone stays REACHABLE
    // instead: visible under `All templates` (the fallback here, since no workspace matches the
    // active id) and selectable from its own `(no workspace)` entry in the header dropdown.
    expect(q(r, '[data-testid="template-row"]').textContent).toContain('Orphan')
    expect(optionValues(r.container, 'template-scope-filter')).toContain('orphans')
  })

  it('a refused delete says how many rules use the template (T-17)', async () => {
    const uses: Rule = {
      id: 'r1',
      name: 'r',
      workspaceId: null,
      trigger: { kind: 'launched' },
      conditions: [{ kind: 'template', templateId: T1.id }],
      actions: [{ kind: 'add-tag', tagId: 't' }]
    }
    act(() => rulesStore.getState().hydrate({ rules: [uses], brokenIds: [] }))
    remove.mockRejectedValueOnce(
      new Error("Error invoking remote method 'templates:delete': Error: template_in_use")
    )
    const { r } = render()
    click(q(r, `[data-template-id="${T1.id}"]`))
    click(q(r, '[data-testid="template-delete"]'))
    click(q(r, '[data-testid="template-delete"]'))
    await flush()
    expect(q(r, '[data-testid="template-error"]').textContent).toBe(
      'Used by 1 rule. Change or delete it first.'
    )
    act(() => rulesStore.setState({ rules: [], brokenIds: [], loaded: false }))
  })
})
