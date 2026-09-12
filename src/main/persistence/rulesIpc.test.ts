import { describe, it, expect } from 'vitest'
import { createRulesStore } from './rules'
import { createRulesIpcHandlers } from './rulesIpc'

const REQ = {
  name: '  tag launches ',
  workspaceId: null,
  trigger: { kind: 'launched' },
  conditions: [],
  actions: [{ kind: 'add-tag', tagId: 't1' }]
}

function handlers(): ReturnType<typeof createRulesIpcHandlers> {
  let n = 0
  return createRulesIpcHandlers(
    createRulesStore({ newId: () => `r${++n}`, lookupTag: () => ({ workspaceId: null }) })
  )
}

describe('rules IPC handler logic — parse-and-throw on the arg (untrusted cross-process input)', () => {
  it('list / save / move / remove return the view directly; save trims the name', () => {
    const h = handlers()
    expect(h.list()).toEqual({ rules: [], brokenIds: [] })
    expect(h.save(REQ).saved.name).toBe('tag launches')
    h.save({ ...REQ, name: 'second' })
    expect(h.move({ id: 'r2', toIndex: 0 }).rules.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(h.remove({ id: 'r2' }).rules.map((r) => r.id)).toEqual(['r1'])
  })

  it('a MALFORMED arg throws and does NOT mutate', () => {
    const h = handlers()
    expect(() => h.save({ ...REQ, actions: [] })).toThrow()
    expect(() =>
      h.save({ ...REQ, trigger: { kind: 'time-in-column', column: 'idle', minutes: 7 } })
    ).toThrow()
    expect(() => h.move({ id: 'r1', toIndex: -1 })).toThrow()
    expect(() => h.remove({ id: '' })).toThrow()
    expect(h.list().rules).toEqual([])
  })
})
