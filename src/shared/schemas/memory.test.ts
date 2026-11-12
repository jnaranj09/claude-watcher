import { describe, expect, it } from 'vitest'
import {
  MEMORY_ERROR,
  MEMORY_LIMITS,
  MemoryActivitySchema,
  MemoryCreateSchema,
  MemoryEditSchema,
  MemoryItemSchema,
  MemoryListSchema,
  MemoryRestoreSchema,
  MemoryRowSchema,
  MemorySetStateSchema,
  MemoryVersionSchema
} from './memory'

const specific = { kind: 'specific', key: 'API port', value: '8080' } as const
const fact = { kind: 'fact', title: 'Deploy', body: 'line one\nline two' } as const
const create = (text: unknown, check: string | null = null): unknown => ({
  workspaceId: null,
  check,
  text
})

describe('memory text limits', () => {
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

  it('parses a version', () => {
    expect(
      MemoryVersionSchema.safeParse({ at: 1, by: 'operator', reason: null, head: 'k', body: 'v' })
        .success
    ).toBe(true)
  })

  it('parses an activity with and without an injection', () => {
    expect(
      MemoryActivitySchema.safeParse({
        injected: { tokens: 3, itemIds: ['m1'] },
        entries: [{ at: 1, action: 'pulled', tool: 'memory_get', itemId: null }]
      }).success
    ).toBe(true)
    expect(MemoryActivitySchema.safeParse({ injected: null, entries: [] }).success).toBe(true)
  })
})
