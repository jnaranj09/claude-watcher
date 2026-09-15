import { describe, it, expect, vi } from 'vitest'
import { createRulesStore, RULE_ERROR, type RulesBlobStore, type ScopedLookup } from './rules'
import type { Rule, RuleSaveRequest, RulesFile } from '../../shared/schemas/rule'

// The catalog the store checks against: a global tag, a tag scoped to w1, a global template.
const TAGS: Record<string, { workspaceId: string | null }> = {
  't-global': { workspaceId: null },
  't-w1': { workspaceId: 'w1' }
}
const TEMPLATES: Record<string, { workspaceId: string | null }> = {
  'tpl-global': { workspaceId: null }
}

const REQ: RuleSaveRequest = {
  name: 'tag prod folders',
  workspaceId: null,
  trigger: { kind: 'launched' },
  conditions: [{ kind: 'folder', mode: 'contains', pattern: '/prod' }],
  actions: [{ kind: 'add-tag', tagId: 't-global' }]
}

function fakeBlob(
  seed: unknown,
  opts: { writeThrows?: boolean } = {}
): { blobStore: RulesBlobStore; backups: () => number; current: () => unknown } {
  let blob: unknown = seed
  let backups = 0
  const blobStore: RulesBlobStore = {
    read: () => blob,
    write: (value: RulesFile) => {
      if (opts.writeThrows) throw new Error('io')
      blob = value
    },
    backup: () => {
      backups++
    }
  }
  return { blobStore, backups: () => backups, current: () => blob }
}

function make(
  seed: unknown = undefined,
  over: { lookupTag?: ScopedLookup; writeThrows?: boolean } = {}
): {
  store: ReturnType<typeof createRulesStore>
  fake: ReturnType<typeof fakeBlob>
  log: ReturnType<typeof vi.fn>
} {
  const fake = fakeBlob(seed, over)
  const log = vi.fn()
  let n = 0
  const store = createRulesStore({
    blobStore: fake.blobStore,
    log,
    newId: () => `r${++n}`,
    lookupTag: over.lookupTag ?? ((id) => TAGS[id] ?? null),
    lookupTemplate: (id) => TEMPLATES[id] ?? null
  })
  return { store, fake, log }
}

const names = (rules: Rule[]): string[] => rules.map((r) => r.name)

describe('createRulesStore — load', () => {
  it('fresh install: empty, writes the empty v1 file, logs nothing', () => {
    const { store, fake, log } = make()
    expect(store.view()).toEqual({ rules: [], brokenIds: [] })
    expect(fake.current()).toEqual({ version: 1, rules: [] })
    expect(log).not.toHaveBeenCalled()
  })

  it('keeps the FILE order — the run order (T-14) — never a name sort', () => {
    const { store } = make({
      version: 1,
      rules: [
        { id: 'b', ...REQ, name: 'zeta' },
        { id: 'a', ...REQ, name: 'alpha' }
      ]
    })
    expect(names(store.list())).toEqual(['zeta', 'alpha'])
  })

  it('corrupt file: backup + empty + code, and the log never carries a value', () => {
    const { store, fake, log } = make({ version: 1, rules: [{ id: 'x', ...REQ, actions: [] }] })
    expect(store.list()).toEqual([])
    expect(fake.backups()).toBe(1)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[claude-watcher][rules] code=rules_corrupt_reset_to_defaults')
    for (const line of lines) expect(line).not.toContain('/prod')
  })

  // T-23 — a bad pattern or a dangling reference makes ONE rule inert; the file is NOT reset.
  it('a stored rule with a bad regex or a missing tag loads, and is reported broken', () => {
    const { store, fake } = make({
      version: 1,
      rules: [
        { id: 'bad-regex', ...REQ, conditions: [{ kind: 'name', mode: 'regex', pattern: '(' }] },
        { id: 'dangling', ...REQ, actions: [{ kind: 'add-tag', tagId: 't-gone' }] },
        { id: 'fine', ...REQ }
      ]
    })
    expect(store.list()).toHaveLength(3)
    expect(fake.backups()).toBe(0)
    expect(store.view().brokenIds).toEqual(['bad-regex', 'dangling'])
  })

  it('a broken rule turns fine again when what it points at comes back', () => {
    let known = false
    const { store } = make(
      { version: 1, rules: [{ id: 'r', ...REQ, actions: [{ kind: 'add-tag', tagId: 't-late' }] }] },
      { lookupTag: (id) => (id === 't-late' && known ? { workspaceId: null } : (TAGS[id] ?? null)) }
    )
    expect(store.view().brokenIds).toEqual(['r'])
    known = true
    expect(store.view().brokenIds).toEqual([])
  })
})

describe('createRulesStore — save refuses what could never run (§1.4)', () => {
  it('create appends LAST; update keeps its place', () => {
    const { store } = make()
    store.save({ ...REQ, name: 'first' })
    store.save({ ...REQ, name: 'second' })
    const out = store.save({ id: 'r1', ...REQ, name: 'first, renamed' })
    expect(out.saved.id).toBe('r1')
    expect(names(out.rules)).toEqual(['first, renamed', 'second'])
  })

  it('an unknown id throws rule_not_found', () => {
    expect(() => make().store.save({ id: 'ghost', ...REQ })).toThrow(RULE_ERROR.notFound)
  })

  it('a missing tag or template throws rule_ref_missing', () => {
    const { store } = make()
    expect(() => store.save({ ...REQ, actions: [{ kind: 'add-tag', tagId: 't-gone' }] })).toThrow(
      RULE_ERROR.refMissing
    )
    expect(() =>
      store.save({ ...REQ, conditions: [{ kind: 'template', templateId: 'tpl-gone' }] })
    ).toThrow(RULE_ERROR.refMissing)
    expect(() =>
      store.save({ ...REQ, conditions: [{ kind: 'lacks-tag', tagId: 't-gone' }] })
    ).toThrow(RULE_ERROR.refMissing)
  })

  it('T-11 — a GLOBAL rule may not use a scoped tag; a workspace rule may use its own and global ones', () => {
    const { store } = make()
    expect(() => store.save({ ...REQ, actions: [{ kind: 'add-tag', tagId: 't-w1' }] })).toThrow(
      RULE_ERROR.refOutOfScope
    )
    expect(() =>
      store.save({ ...REQ, workspaceId: 'w2', actions: [{ kind: 'add-tag', tagId: 't-w1' }] })
    ).toThrow(RULE_ERROR.refOutOfScope)
    expect(
      store.save({
        ...REQ,
        workspaceId: 'w1',
        conditions: [{ kind: 'has-tag', tagId: 't-global' }],
        actions: [{ kind: 'add-tag', tagId: 't-w1' }]
      }).saved.workspaceId
    ).toBe('w1')
  })

  it('a regex that does not compile throws rule_bad_pattern; a contains pattern never does', () => {
    const { store } = make()
    expect(() =>
      store.save({ ...REQ, conditions: [{ kind: 'folder', mode: 'regex', pattern: '(' }] })
    ).toThrow(RULE_ERROR.badPattern)
    expect(() =>
      store.save({ ...REQ, conditions: [{ kind: 'folder', mode: 'contains', pattern: '(' }] })
    ).not.toThrow()
  })
})

describe('createRulesStore — remove / move / cascade / references', () => {
  function three(): ReturnType<typeof createRulesStore> {
    const { store } = make()
    for (const name of ['a', 'b', 'c']) store.save({ ...REQ, name })
    return store
  }

  it('remove drops the rule; an unknown id is a no-op', () => {
    const store = three()
    expect(names(store.remove('r2').rules)).toEqual(['a', 'c'])
    expect(names(store.remove('r2').rules)).toEqual(['a', 'c'])
  })

  it('move puts the rule at its FINAL index, clamped; an unknown id throws', () => {
    const store = three()
    expect(names(store.move('r3', 0).rules)).toEqual(['c', 'a', 'b'])
    expect(names(store.move('r3', 99).rules)).toEqual(['a', 'b', 'c'])
    expect(names(store.move('r1', 1).rules)).toEqual(['b', 'a', 'c'])
    expect(() => store.move('ghost', 0)).toThrow(RULE_ERROR.notFound)
  })

  it('removeByWorkspace deletes only that workspace and persists', () => {
    const { store, fake } = make()
    store.save({ ...REQ, name: 'global' })
    store.save({ ...REQ, name: 'w1 rule', workspaceId: 'w1' })
    expect(store.removeByWorkspace('w1')).toBe(1)
    expect(names(store.list())).toEqual(['global'])
    expect((fake.current() as RulesFile).rules).toHaveLength(1)
  })

  it('refsToTag reports every rule that uses a tag, in a condition or an action, with its scope', () => {
    const { store } = make()
    store.save({ ...REQ, conditions: [{ kind: 'has-tag', tagId: 't-global' }] })
    store.save({ ...REQ, workspaceId: 'w1', actions: [{ kind: 'remove-tag', tagId: 't-w1' }] })
    expect(store.refsToTag('t-global')).toEqual([{ ruleWorkspaceId: null }])
    expect(store.refsToTag('t-w1')).toEqual([{ ruleWorkspaceId: 'w1' }])
    expect(store.refsToTag('t-nobody')).toEqual([])
  })

  it('countTemplateRefs counts the rules whose template condition names it', () => {
    const { store } = make()
    store.save({ ...REQ, conditions: [{ kind: 'template', templateId: 'tpl-global' }] })
    store.save({ ...REQ, conditions: [{ kind: 'template', templateId: 'tpl-global' }] })
    expect(store.countTemplateRefs('tpl-global')).toBe(2)
    expect(store.countTemplateRefs('tpl-other')).toBe(0)
  })

  it('refsToTemplate reports every rule whose template condition names it, with its scope', () => {
    const { store } = make()
    const uses = [{ kind: 'template' as const, templateId: 'tpl-global' }]
    store.save({ ...REQ, conditions: uses })
    store.save({ ...REQ, workspaceId: 'w1', conditions: uses })
    expect(store.refsToTemplate('tpl-global')).toEqual([
      { ruleWorkspaceId: null },
      { ruleWorkspaceId: 'w1' }
    ])
    expect(store.refsToTemplate('tpl-other')).toEqual([])
  })

  it('a failed write logs rules_write_failed and keeps the in-memory rule', () => {
    const { store, log } = make(undefined, { writeThrows: true })
    store.save(REQ)
    expect(store.list()).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][rules] code=rules_write_failed')
  })
})
