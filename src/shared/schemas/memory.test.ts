import { describe, expect, it } from 'vitest'
import {
  MEMORY_ERROR,
  MEMORY_LIMITS,
  MemoryActivitySchema,
  MemoryCreateSchema,
  MemoryEditSchema,
  MemoryExtractResultSchema,
  MemoryItemSchema,
  MemoryListSchema,
  MemoryRecallModeSchema,
  MEMORY_RECALL_SKIPS,
  MemoryRestoreSchema,
  MemoryRowSchema,
  MemorySetStateSchema,
  MemorySourceSchema,
  MemoryTextSchema,
  MemoryVersionSchema,
  NO_COUNTS
} from './memory'

const specific = { kind: 'specific', key: 'API port', value: '8080' } as const
const fact = { kind: 'fact', title: 'Deploy', body: 'line one\nline two' } as const
const create = (text: unknown, check: string | null = null): unknown => ({
  workspaceId: null,
  check,
  text
})

describe('memory text limits', () => {
  it("MEMORY_LIMITS holds the spec's numbers", () => {
    expect(MEMORY_LIMITS).toEqual({
      specificKey: 120,
      specificValue: 500,
      factTitle: 120,
      factBody: 2000,
      episodeTitle: 120,
      episodeBody: 2000,
      sourceQuote: 500,
      commandText: 500,
      check: 300,
      reason: 200,
      query: 200,
      searchLimit: 20,
      listLimit: 100,
      indexChars: 6000,
      indexCeilingChars: 24_000,
      recallPromptChars: 2000,
      recallTerms: 12,
      recallRows: 3,
      recallLineChars: 600,
      recallChars: 2000,
      recallWindowChars: 20_000,
      atUseFolders: 5,
      atUseRows: 10,
      atUseChars: 1500,
      indexFolders: 200,
      windowItems: 500,
      rememberChars: 8000,
      twinsShown: 5
    })
  })

  it('accepts a specific and a fact', () => {
    expect(MemoryCreateSchema.safeParse(create(specific)).success).toBe(true)
    expect(MemoryCreateSchema.safeParse(create(fact)).success).toBe(true)
  })

  it('refuses a specific whose value is over 500 characters', () => {
    const over = { ...specific, value: 'x'.repeat(MEMORY_LIMITS.specificValue + 1) }
    expect(MemoryCreateSchema.safeParse(create(over)).success).toBe(false)
  })

  it('accepts a specific whose value is exactly 500 characters', () => {
    const at = { ...specific, value: 'x'.repeat(MEMORY_LIMITS.specificValue) }
    expect(MemoryCreateSchema.safeParse(create(at)).success).toBe(true)
  })

  it('refuses a key, title, body and check over their limit', () => {
    const key = { ...specific, key: 'k'.repeat(MEMORY_LIMITS.specificKey + 1) }
    const title = { ...fact, title: 't'.repeat(MEMORY_LIMITS.factTitle + 1) }
    const body = { ...fact, body: 'b'.repeat(MEMORY_LIMITS.factBody + 1) }
    expect(MemoryCreateSchema.safeParse(create(key)).success).toBe(false)
    expect(MemoryCreateSchema.safeParse(create(title)).success).toBe(false)
    expect(MemoryCreateSchema.safeParse(create(body)).success).toBe(false)
    expect(
      MemoryCreateSchema.safeParse(create(specific, 'c'.repeat(MEMORY_LIMITS.check + 1))).success
    ).toBe(false)
  })

  it('trims text', () => {
    const parsed = MemoryCreateSchema.parse(create({ ...specific, key: '  API port  ' }))
    expect(parsed.text).toEqual(specific)
  })

  it('refuses an empty text', () => {
    expect(MemoryCreateSchema.safeParse(create({ ...specific, value: '   ' })).success).toBe(false)
  })

  it('keeps a line break in a fact body and refuses one in a specific value', () => {
    expect(MemoryCreateSchema.safeParse(create(fact)).success).toBe(true)
    expect(MemoryCreateSchema.safeParse(create({ ...specific, value: 'a\nb' })).success).toBe(false)
    expect(MemoryCreateSchema.safeParse(create({ ...fact, title: 'a\nb' })).success).toBe(false)
    expect(MemoryCreateSchema.safeParse(create(specific, 'a\nb')).success).toBe(false)
  })

  it('refuses another control character, even in a fact body', () => {
    expect(MemoryCreateSchema.safeParse(create({ ...fact, body: 'a\u0007b' })).success).toBe(false)
    expect(MemoryCreateSchema.safeParse(create({ ...fact, body: 'a\r\nb' })).success).toBe(false)
  })

  it('refuses an unknown key and an unknown kind', () => {
    expect(
      MemoryCreateSchema.safeParse({ ...(create(specific) as object), extra: 1 }).success
    ).toBe(false)
    expect(
      MemoryCreateSchema.safeParse(create({ kind: 'other', key: 'a', value: 'b' })).success
    ).toBe(false)
    expect(MemoryCreateSchema.safeParse(create({ ...specific, extra: 1 })).success).toBe(false)
  })
})

describe('memory IPC requests', () => {
  it('edit takes an id, text and check', () => {
    expect(MemoryEditSchema.safeParse({ id: 'm1', text: fact, check: null }).success).toBe(true)
    expect(MemoryEditSchema.safeParse({ id: '', text: fact, check: null }).success).toBe(false)
  })

  it('set-state takes only active or stale', () => {
    expect(MemorySetStateSchema.safeParse({ id: 'm1', state: 'stale' }).success).toBe(true)
    expect(MemorySetStateSchema.safeParse({ id: 'm1', state: 'gone' }).success).toBe(false)
  })

  it('restore takes an id and a version time', () => {
    expect(MemoryRestoreSchema.safeParse({ id: 'm1', versionAt: 5 }).success).toBe(true)
    expect(MemoryRestoreSchema.safeParse({ id: 'm1' }).success).toBe(false)
  })

  const list = {
    workspaceId: 'default',
    includeGlobal: true,
    kind: 'specific',
    query: null,
    filters: {},
    offset: 0,
    limit: 50
  }

  it('list needs a kind', () => {
    expect(MemoryListSchema.safeParse(list).success).toBe(true)
    expect(MemoryListSchema.safeParse({ ...list, kind: null }).success).toBe(false)
  })

  it('list caps the limit at 100', () => {
    const over = { ...list, limit: MEMORY_LIMITS.listLimit + 1 }
    expect(MemoryListSchema.safeParse(over).success).toBe(false)
  })

  it('list and a list row take the episode kind', () => {
    expect(MemoryListSchema.safeParse({ ...list, kind: 'episode' }).success).toBe(true)
    const row = {
      id: 'e1',
      kind: 'episode',
      head: 'Fixed the login bug',
      body: 'Found the cause and fixed it.',
      updatedAt: 1,
      basis: 'observed',
      state: 'active',
      pinned: false,
      workspaceId: null,
      folder: null,
      sessionName: null,
      tagIds: [],
      originDeletedAt: null
    }
    expect(MemoryRowSchema.safeParse(row).success).toBe(true)
  })

  it('list refuses an unknown key and an unknown filter key', () => {
    expect(MemoryListSchema.safeParse({ ...list, extra: 1 }).success).toBe(false)
    expect(MemoryListSchema.safeParse({ ...list, filters: { nope: true } }).success).toBe(false)
  })
})

describe('memory records', () => {
  const item = {
    id: 'm1',
    workspaceId: null,
    state: 'active',
    pinned: false,
    basis: 'stated',
    check: null,
    lastSeenAt: 1,
    createdAt: 1,
    updatedAt: 1,
    origin: { by: 'agent', sessionId: null },
    originDeletedAt: null,
    source: null,
    meta: {
      folder: null,
      sessionName: null,
      tagIds: [],
      templateId: null,
      goalId: null,
      taskIds: []
    }
  }

  it('parses an item of either kind', () => {
    expect(MemoryItemSchema.safeParse({ ...item, ...specific }).success).toBe(true)
    expect(MemoryItemSchema.safeParse({ ...item, ...fact }).success).toBe(true)
  })

  it('parses a list row', () => {
    expect(
      MemoryRowSchema.safeParse({
        id: 'm1',
        kind: 'fact',
        head: 'Deploy',
        body: 'make deploy',
        updatedAt: 1,
        basis: 'observed',
        state: 'stale',
        pinned: true,
        workspaceId: 'default',
        folder: '/a',
        sessionName: null,
        tagIds: ['t'],
        originDeletedAt: 2
      }).success
    ).toBe(true)
  })

  it('a list row carries its current text', () => {
    const row = {
      id: 'm1',
      kind: 'specific',
      head: 'port',
      updatedAt: 1,
      basis: 'observed',
      state: 'active',
      pinned: false,
      workspaceId: null,
      folder: null,
      sessionName: null,
      tagIds: [],
      originDeletedAt: null
    }
    expect(MemoryRowSchema.safeParse(row).success).toBe(false)
    expect(MemoryRowSchema.safeParse({ ...row, body: '9281' }).success).toBe(true)
  })

  it('MEMORY_ERROR names the code main throws while it has no store', () => {
    expect(MEMORY_ERROR.unavailable).toBe('memory_unavailable')
  })

  it('parses a version with the basis of its text', () => {
    const version = { at: 1, by: 'operator', basis: 'stated', reason: null, head: 'k', body: 'v' }
    expect(MemoryVersionSchema.safeParse(version).success).toBe(true)
    expect(MemoryVersionSchema.safeParse({ ...version, basis: 'guessed' }).success).toBe(false)
  })

  it('parses an activity with and without an injection', () => {
    expect(
      MemoryActivitySchema.safeParse({
        injected: { tokens: 3, itemIds: ['m1'] },
        entries: [{ at: 1, action: 'pulled', tool: 'memory_get', itemId: null, reason: null }],
        recall: null
      }).success
    ).toBe(true)
    expect(
      MemoryActivitySchema.safeParse({ injected: null, entries: [], recall: null }).success
    ).toBe(true)
  })

  it('an activity carries its recall mode and an injected entry', () => {
    const base = {
      injected: null,
      entries: [{ at: 1, action: 'injected', tool: 'prompt', itemId: 'm1', reason: null }]
    }
    expect(
      [{ mode: 'mod' }, { mode: 'launch', reason: 'claude_too_old' }, null, { mode: 'launch' }].map(
        (recall) => MemoryActivitySchema.safeParse({ ...base, recall }).success
      )
    ).toEqual([true, true, true, false])
    expect(MemoryActivitySchema.safeParse(base).success).toBe(false) // recall is required (nullable)
  })

  it('the recall skips are the three reasons recall can fall back to launch', () => {
    expect(MEMORY_RECALL_SKIPS).toEqual(['setting_off', 'claude_too_old', 'mod_not_installed'])
    expect(MemoryRecallModeSchema.safeParse({ mode: 'mod', reason: 'setting_off' }).success).toBe(
      false
    )
  })

  it('an activity entry may be a drop with a known reason, and only a known one', () => {
    const drop = {
      at: 1,
      action: 'dropped',
      tool: 'extract',
      itemId: null,
      reason: 'evidence_not_found'
    }
    expect(
      MemoryActivitySchema.safeParse({ injected: null, entries: [drop], recall: null }).success
    ).toBe(true)
    expect(
      MemoryActivitySchema.safeParse({
        injected: null,
        entries: [{ ...drop, reason: 'other' }],
        recall: null
      }).success
    ).toBe(false)
  })

  it('P3-R1: an activity entry may be a drop of an update only claude supported', () => {
    const drop = { at: 1, action: 'dropped', tool: 'extract', itemId: null, reason: 'claude_only' }
    expect(
      MemoryActivitySchema.parse({ injected: null, entries: [drop], recall: null }).entries
    ).toEqual([drop])
  })

  const episodeItem = {
    ...item,
    kind: 'episode',
    title: 'Fixed the login bug',
    body: 'The session found the cause and fixed it.',
    endedAt: 5,
    source: { entryId: 'e12', quote: 'the token check was off by one' }
  }

  it('accepts an episode item and refuses an episode as a text to save', () => {
    expect(MemoryItemSchema.safeParse(episodeItem).success).toBe(true)
    expect(
      MemoryTextSchema.safeParse({ kind: 'episode', title: 'a', body: 'b', endedAt: 1 }).success
    ).toBe(false)
  })

  it('refuses a source quote over 500 characters', () => {
    const at = { entryId: 'e1', quote: 'x'.repeat(MEMORY_LIMITS.sourceQuote) }
    expect(MemorySourceSchema.safeParse(at).success).toBe(true)
    expect(MemorySourceSchema.safeParse({ ...at, quote: 'x'.repeat(501) }).success).toBe(false)
  })

  it('a push with an unknown key or a negative count is refused', () => {
    const push = {
      sessionName: 'billing api',
      trigger: 'end',
      outcome: 'saved',
      counts: { ...NO_COUNTS, facts: 2 },
      reason: null
    }
    expect(MemoryExtractResultSchema.safeParse(push).success).toBe(true)
    expect(MemoryExtractResultSchema.safeParse({ ...push, extra: 1 }).success).toBe(false)
    expect(
      MemoryExtractResultSchema.safeParse({ ...push, counts: { ...NO_COUNTS, tasks: -1 } }).success
    ).toBe(false)
  })
})
