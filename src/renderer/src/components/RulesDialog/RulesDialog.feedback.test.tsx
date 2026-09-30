// Action feedback (spec 2026-09-29 §2.5) — ↑/↓ are busy while a move is in flight (a second press
// would compute its index from a stale list), and a refused move says so on the error line (it was
// console only).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred, type Deferred } from '../../test/deferred'
import { RulesDialog } from './RulesDialog'
import { rulesStore } from '../../stores/rulesStore'
import { tagsStore } from '../../stores/tagsStore'
import { templatesStore } from '../../stores/templatesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Rule } from '../../../../shared/ipc/contract'

const R_A: Rule = {
  id: 'ra',
  name: 'first',
  workspaceId: null,
  trigger: { kind: 'launched' },
  conditions: [],
  actions: []
}
const R_B: Rule = { ...R_A, id: 'rb', name: 'second' }

let r: RenderResult | undefined
let pending: Deferred<unknown>
let move: ReturnType<typeof vi.fn>

beforeEach(() => {
  pending = deferred<unknown>()
  move = vi.fn(() => pending.promise)
  ;(window as unknown as { rules: unknown }).rules = {
    list: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    move
  }
  act(() => {
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: true })
    tagsStore.setState({ tags: [], loaded: true, activeTagId: null })
    templatesStore.getState().hydrate([])
    rulesStore.getState().hydrate({ rules: [R_A, R_B], brokenIds: [] })
  })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  vi.restoreAllMocks()
})

function el<T extends Element = HTMLElement>(id: string): T {
  const found = r?.container.querySelector<T>(`[data-testid="${id}"]`)
  if (found === null || found === undefined) throw new Error(`missing ${id}`)
  return found
}

describe('RulesDialog — ↑/↓ feedback', () => {
  it('the arrows are busy while a move is in flight; a refusal says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    r = renderComponent(<RulesDialog onClose={() => {}} />)
    act(() => el('rule-down-ra').click())
    expect(el('rule-down-ra').getAttribute('aria-busy')).toBe('true')
    act(() => el('rule-up-rb').click())
    expect(move).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('rule_not_found'))
      await pending.promise.catch(() => {})
    })
    expect(el('rule-error').textContent).toBe('Could not move the rule.')
    expect(el('rule-down-ra').hasAttribute('aria-busy')).toBe(false)
  })
})
