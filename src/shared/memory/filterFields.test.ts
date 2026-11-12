import { describe, expect, it } from 'vitest'
import { MEMORY_FILTER_FIELDS, MemoryFiltersSchema, memoryFilterJsonSchema } from './filterFields'

const names = MEMORY_FILTER_FIELDS.map((f) => f.name).sort()

describe('memory filter fields', () => {
  it('has one schema key and one JSON-schema property per filter field', () => {
    expect(Object.keys(MemoryFiltersSchema.shape).sort()).toEqual(names)
    expect(Object.keys(memoryFilterJsonSchema()).sort()).toEqual(names)
  })

  it('gives every JSON-schema property its description', () => {
    const props = memoryFilterJsonSchema()
    for (const f of MEMORY_FILTER_FIELDS) {
      expect(props[f.name]).toMatchObject({ description: f.description })
    }
  })

  it('types a property by its control', () => {
    const props = memoryFilterJsonSchema()
    expect(props['folder']).toMatchObject({ type: 'string' })
    expect(props['tags']).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(props['since']).toMatchObject({ type: 'string' })
    expect(props['includeStale']).toMatchObject({ type: 'boolean' })
  })

  it('types every schema key by its field control', () => {
    const sample = { folder: 'a', text: 'a', tags: ['a'], date: '2026-01-02', toggle: true }
    const wrong = { folder: 1, text: true, tags: 'a', date: 5, toggle: 'a' }
    for (const f of MEMORY_FILTER_FIELDS) {
      expect(MemoryFiltersSchema.safeParse({ [f.name]: sample[f.control] }).success).toBe(true)
      expect(MemoryFiltersSchema.safeParse({ [f.name]: wrong[f.control] }).success).toBe(false)
    }
  })

  it('accepts an empty object', () => {
    expect(MemoryFiltersSchema.safeParse({}).success).toBe(true)
  })

  it('accepts every key at once', () => {
    expect(
      MemoryFiltersSchema.safeParse({
        folder: 'here',
        session: 'build',
        tags: ['a'],
        since: '2026-01-02',
        until: '2026-02-03',
        goal: 'g',
        sessionDeleted: true,
        includeStale: false
      }).success
    ).toBe(true)
  })

  it('refuses an unknown filter key', () => {
    expect(MemoryFiltersSchema.safeParse({ nope: 1 }).success).toBe(false)
  })

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(MemoryFiltersSchema.safeParse({ since: '2026-1-2' }).success).toBe(false)
    expect(MemoryFiltersSchema.safeParse({ since: 'yesterday' }).success).toBe(false)
    expect(MemoryFiltersSchema.safeParse({ until: '2026-02-30' }).success).toBe(false)
  })

  it('refuses an empty text, an empty tag and a non-boolean toggle', () => {
    expect(MemoryFiltersSchema.safeParse({ session: '  ' }).success).toBe(false)
    expect(MemoryFiltersSchema.safeParse({ tags: [''] }).success).toBe(false)
    expect(MemoryFiltersSchema.safeParse({ includeStale: 'yes' }).success).toBe(false)
  })
})
