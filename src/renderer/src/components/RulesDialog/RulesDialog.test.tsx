// Rules — the Manage-rules dialog (spec §4.4). jsdom `unit` project; `renderComponent` +
// `selectHarness`, like TemplatesDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionValues, selectedValue } from '../../test/selectHarness'
import { RulesDialog } from './RulesDialog'
import { rulesStore } from '../../stores/rulesStore'
import { tagsStore } from '../../stores/tagsStore'
import { templatesStore } from '../../stores/templatesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Rule, RuleSaveRequest, Tag, Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const TAGS: Tag[] = [
  { id: 't-ops', name: 'ops-only', color: 'blue', workspaceId: 'w1' },
  { id: 't-pending', name: 'pending', color: 'violet', workspaceId: null }
]
// RUN order: the names are deliberately NOT alphabetical.
const R_A: Rule = {
  id: 'ra',
  name: 'zeta runs first',
  workspaceId: null,
  trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
  conditions: [],
  actions: [{ kind: 'remove-tag', tagId: 't-pending' }]
}
const R_B: Rule = {
  ...R_A,
  id: 'rb',
  name: 'alpha runs second',
  trigger: { kind: 'time-in-column', column: 'idle', minutes: 30 }
}
const R_C: Rule = { ...R_A, id: 'rc', name: 'broken runs third', trigger: { kind: 'launched' } }

let cleanup: (() => void) | undefined
let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
let move: ReturnType<typeof vi.fn>

beforeEach(() => {
  save = vi.fn((req: RuleSaveRequest) => {
    const saved: Rule = { ...req, id: req.id ?? 'r-new' }
    return Promise.resolve({ saved, rules: [R_A, R_B, R_C, saved], brokenIds: ['rc'] })
  })
  remove = vi.fn(() => Promise.resolve({ rules: [R_B, R_C], brokenIds: ['rc'] }))
  move = vi.fn(() => Promise.resolve({ rules: [R_B, R_A, R_C], brokenIds: ['rc'] }))
  ;(window as unknown as { rules: unknown }).rules = { list: vi.fn(), save, remove, move }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'default', loaded: true })
    tagsStore.setState({ tags: TAGS, loaded: true, activeTagId: null })
    templatesStore.getState().hydrate([])
    rulesStore.getState().hydrate({ rules: [R_A, R_B, R_C], brokenIds: ['rc'] })
  })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => {
    rulesStore.setState({ rules: [], brokenIds: [], loaded: false })
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
  const r = renderComponent(<RulesDialog onClose={onClose} />)
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
const rowTexts = (r: RenderResult): string[] =>
  [...r.container.querySelectorAll('[data-testid^="rule-select-"]')].map((b) => b.textContent ?? '')

describe('RulesDialog', () => {
  it('lists the rules in RUN order with their trigger summaries, and marks a broken one', () => {
    const { r } = render()
    chooseOption(r.container, 'rule-scope-filter', 'all')
    expect(rowTexts(r)).toEqual([
      'zeta runs firstWorking → Needs you',
      'alpha runs secondIdle for 30 min',
      'broken runs thirdOn launch (broken)'
    ])
    expect(r.container.querySelector('[data-testid="rule-broken-rc"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="rule-broken-ra"]')).toBeNull()
  })

  // R-uniform (controller ruling): the slot's width must stay uniform, so ↑ / ↓ are rendered on
  // EVERY row once there is more than one, disabled (not omitted) at the ends. That is a change
  // from "no button past the ends" to "a disabled button past the ends" — check `.disabled`, not
  // absence.
  it('↑ / ↓ are the only reorder: disabled past the ends, and a press moves past the neighbour', async () => {
    const { r } = render()
    chooseOption(r.container, 'rule-scope-filter', 'all')
    expect(q<HTMLButtonElement>(r, '[data-testid="rule-up-ra"]').disabled).toBe(true)
    expect(q<HTMLButtonElement>(r, '[data-testid="rule-down-rc"]').disabled).toBe(true)
    // The far ends' OTHER direction stays enabled.
    expect(q<HTMLButtonElement>(r, '[data-testid="rule-down-ra"]').disabled).toBe(false)
    expect(q<HTMLButtonElement>(r, '[data-testid="rule-up-rc"]').disabled).toBe(false)
    click(q(r, '[data-testid="rule-down-ra"]'))
    await flush()
    expect(move).toHaveBeenCalledWith('ra', 1)
    expect(rowTexts(r)[0]).toContain('alpha runs second')
  })

  // P2-4 / T-14 — a WORKSPACE scope hides rules that still run in between (a global one before,
  // Default's between). ↑ / ↓ move past the VISIBLE neighbour, but `rules:move` takes the final
  // index in the FULL list — the neighbour's index in the filtered list would drop the rule in the
  // wrong place in the run order.
  it('in a workspace scope, ↑ / ↓ pass the visible neighbour’s index in the FULL list', async () => {
    const opsFirst: Rule = { ...R_A, id: 'wa', name: 'ops first', workspaceId: 'w1' }
    const opsSecond: Rule = { ...R_A, id: 'wc', name: 'ops second', workspaceId: 'w1' }
    const hidden: Rule = { ...R_A, id: 'hidden', name: 'default only', workspaceId: 'default' }
    const full = { rules: [R_A, opsFirst, hidden, opsSecond], brokenIds: [] }
    move.mockImplementation(() => Promise.resolve(full))
    act(() => rulesStore.getState().hydrate(full))
    const { r } = render()
    chooseOption(r.container, 'rule-scope-filter', 'ws:w1')
    expect(rowTexts(r)).toEqual(['ops firstWorking → Needs you', 'ops secondWorking → Needs you'])
    click(q(r, '[data-testid="rule-down-wa"]'))
    await flush()
    expect(move).toHaveBeenLastCalledWith('wa', 3)
    click(q(r, '[data-testid="rule-up-wc"]'))
    await flush()
    expect(move).toHaveBeenLastCalledWith('wc', 1)
  })

  // R-keyboard (controller ruling): the actions are revealed by CSS `:focus-within` on the row, so
  // Shift+Tab from row B's select button skips row A's hidden-until-focus ↑/↓ and lands on row A's
  // select button — that ordering is real but not something jsdom's layout-free DOM can observe
  // (jsdom runs no CSS and implements no Tab-key traversal). What a test CAN check: the ↑/↓ buttons
  // for a row with both directions enabled are real, un-hidden, tab-reachable DOM nodes (no
  // `hidden` attribute, no `tabIndex=-1`, not `disabled`) — so once the row's own select button is
  // focused (which a real browser does via mouse/keyboard) and `:focus-within` reveals the slot,
  // the next Tab genuinely lands on a focusable control rather than a dead one.
  it('the middle row’s ↑ / ↓ are real, un-hidden, focusable controls (reachable once the row is focused)', () => {
    const { r } = render()
    chooseOption(r.container, 'rule-scope-filter', 'all')
    const up = q<HTMLButtonElement>(r, '[data-testid="rule-up-rb"]')
    const down = q<HTMLButtonElement>(r, '[data-testid="rule-down-rb"]')
    for (const btn of [up, down]) {
      expect(btn.hasAttribute('hidden')).toBe(false)
      expect(btn.tabIndex).not.toBe(-1)
      expect(btn.disabled).toBe(false)
    }
  })

  it('creates "Working → Needs you: remove pending" from the form', async () => {
    const { r } = render()
    click(q(r, '[data-testid="rule-new"]'))
    type(q(r, '[data-testid="rule-name"]'), 'clear pending')
    chooseOption(r.container, 'rule-from', 'working')
    click(q(r, '[data-testid="rule-add-condition"]'))
    click(q(r, '[data-testid="rule-add-action"]'))
    chooseOption(r.container, 'rule-action-kind-0', 'remove-tag')
    click(q(r, '[data-testid="rule-save"]'))
    await flush()
    expect(save).toHaveBeenCalledWith({
      name: 'clear pending',
      workspaceId: null,
      trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
      conditions: [{ kind: 'has-tag', tagId: 't-pending' }],
      actions: [{ kind: 'remove-tag', tagId: 't-pending' }]
    })
  })

  it('T-11 — a global rule offers global tags only; a workspace rule adds that workspace’s own', () => {
    const { r } = render()
    click(q(r, '[data-testid="rule-new"]'))
    click(q(r, '[data-testid="rule-add-action"]'))
    expect(optionValues(r.container, 'rule-action-tag-0')).toEqual(['t-pending'])
    chooseOption(r.container, 'rule-scope', 'w1')
    expect(optionValues(r.container, 'rule-action-tag-0')).toEqual(['t-ops', 't-pending'])
  })

  it('an invalid regex blocks Save and says why', () => {
    const { r } = render()
    click(q(r, '[data-testid="rule-new"]'))
    type(q(r, '[data-testid="rule-name"]'), 'by name')
    click(q(r, '[data-testid="rule-add-condition"]'))
    chooseOption(r.container, 'rule-condition-kind-0', 'name')
    chooseOption(r.container, 'rule-condition-mode-0', 'regex')
    type(q(r, '[data-testid="rule-condition-pattern-0"]'), '(')
    click(q(r, '[data-testid="rule-add-action"]'))
    expect(q(r, '[data-testid="rule-hint"]').textContent).toMatch(/not a valid regular expression/)
    expect(q<HTMLButtonElement>(r, '[data-testid="rule-save"]').disabled).toBe(true)
  })

  it('shows the operator copy when main refuses (the wrapped Electron error)', async () => {
    save.mockRejectedValueOnce(
      new Error("Error invoking remote method 'rules:save': Error: rule_ref_out_of_scope")
    )
    const { r } = render()
    click(q(r, '[data-testid="rule-new"]'))
    type(q(r, '[data-testid="rule-name"]'), 'x')
    click(q(r, '[data-testid="rule-add-action"]'))
    click(q(r, '[data-testid="rule-save"]'))
    await flush()
    expect(q(r, '[data-testid="rule-error"]').textContent).toMatch(/cannot see/)
  })

  it('Delete arms, confirms, and returns to the empty form', async () => {
    const { r } = render()
    chooseOption(r.container, 'rule-scope-filter', 'all')
    click(q(r, '[data-testid="rule-select-ra"]'))
    click(q(r, '[data-testid="rule-delete"]'))
    click(q(r, '[data-testid="rule-delete"]'))
    await flush()
    expect(remove).toHaveBeenCalledWith('ra')
    expect(q<HTMLInputElement>(r, '[data-testid="rule-name"]').value).toBe('')
  })

  it('closes on Escape', () => {
    const { r, onClose } = render()
    act(() => {
      q(r, '[data-testid="rules-overlay"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(onClose).toHaveBeenCalled()
  })

  // R-parity (controller ruling): the two scope edge cases the Phase 1 review found missing on
  // TagsDialog, added here for Rules.
  it('opens on `All rules` when the active workspace id names no known workspace', () => {
    act(() => {
      workspacesStore.setState({ activeId: 'ghost-workspace' })
    })
    const { r } = render()
    expect(selectedValue(r.container, 'rule-scope-filter')).toBe('all')
  })

  it('changing the scope closes the open form (selection clears)', () => {
    const { r } = render()
    chooseOption(r.container, 'rule-scope-filter', 'all')
    click(q(r, '[data-testid="rule-select-ra"]'))
    expect(q<HTMLInputElement>(r, '[data-testid="rule-name"]').value).toBe('zeta runs first')
    chooseOption(r.container, 'rule-scope-filter', 'ws:w1')
    expect(q<HTMLInputElement>(r, '[data-testid="rule-name"]').value).toBe('')
  })
})
