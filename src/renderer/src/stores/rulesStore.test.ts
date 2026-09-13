import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createRulesViewStore,
  loadRules,
  moveRule,
  removeRule,
  rulesStore,
  rulesUsingTag,
  rulesUsingTemplate,
  saveRule
} from './rulesStore'
import type { Rule } from '../../../shared/ipc/contract'

const R1: Rule = {
  id: 'r1',
  name: 'b-rule',
  workspaceId: null,
  trigger: { kind: 'launched' },
  conditions: [
    { kind: 'template', templateId: 'tpl' },
    { kind: 'lacks-tag', tagId: 't-a' }
  ],
  actions: [{ kind: 'add-tag', tagId: 't-b' }]
}
const R2: Rule = {
  ...R1,
  id: 'r2',
  name: 'a-rule',
  conditions: [],
  actions: [{ kind: 'remove-tag', tagId: 't-a' }]
}
const VIEW = { rules: [R1, R2], brokenIds: ['r2'] }

interface Bridge {
  list: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  move: ReturnType<typeof vi.fn>
}
function stubBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    list: vi.fn(() => Promise.resolve(VIEW)),
    save: vi.fn(() => Promise.resolve({ saved: R1, ...VIEW })),
    remove: vi.fn(() => Promise.resolve({ rules: [R1], brokenIds: [] })),
    move: vi.fn(() => Promise.resolve({ rules: [R2, R1], brokenIds: ['r2'] })),
    ...overrides
  }
  ;(window as unknown as { rules: Bridge }).rules = bridge
  return bridge
}

afterEach(() => {
  rulesStore.setState({ rules: [], brokenIds: [], loaded: false })
  vi.restoreAllMocks()
})

describe('rulesStore', () => {
  it('hydrate REPLACES the list and keeps main’s RUN order (never re-sorted)', () => {
    const s = createRulesViewStore()
    s.getState().hydrate(VIEW)
    expect(s.getState().rules.map((r) => r.name)).toEqual(['b-rule', 'a-rule'])
    expect(s.getState().brokenIds).toEqual(['r2'])
    expect(s.getState().loaded).toBe(true)
  })

  it('counts the rules using a tag (condition or action) and a template', () => {
    expect(rulesUsingTag([R1, R2], 't-a')).toBe(2)
    expect(rulesUsingTag([R1, R2], 't-b')).toBe(1)
    expect(rulesUsingTemplate([R1, R2], 'tpl')).toBe(1)
    expect(rulesUsingTemplate([R1, R2], 'other')).toBe(0)
  })

  it('load / save / remove / move round-trip through the bridge', async () => {
    const bridge = stubBridge()
    await loadRules()
    expect(rulesStore.getState().rules).toEqual([R1, R2])
    await expect(saveRule({ ...R1 })).resolves.toEqual(R1)
    await removeRule('r2')
    expect(rulesStore.getState().rules).toEqual([R1])
    await moveRule('r2', 0)
    expect(bridge.move).toHaveBeenCalledWith('r2', 0)
    expect(rulesStore.getState().rules).toEqual([R2, R1])
  })

  it('save and remove RETHROW (the dialog shows the reason); load and move log a code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubBridge({
      list: vi.fn(() => Promise.reject(new Error('x'))),
      save: vi.fn(() => Promise.reject(new Error('rule_bad_pattern'))),
      remove: vi.fn(() => Promise.reject(new Error('rule_not_found'))),
      move: vi.fn(() => Promise.reject(new Error('rule_not_found')))
    })
    await loadRules()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][rules] code=rules_load_failed')
    await expect(saveRule({ ...R1 })).rejects.toThrow('rule_bad_pattern')
    await expect(removeRule('r1')).rejects.toThrow('rule_not_found')
    await moveRule('r1', 0)
    expect(warn).toHaveBeenCalledWith('[claude-watcher][rules] code=rules_move_failed')
  })
})
