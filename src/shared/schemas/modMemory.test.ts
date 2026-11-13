// The wire shapes the `watcher-memory` mod sends to main (memory phase 3, `shared-node` project).
import { describe, expect, it } from 'vitest'
import {
  ModMemoryAtUseSchema,
  ModMemoryIndexSchema,
  ModMemoryRecallSchema,
  ModMemoryRememberSchema,
  REMEMBER_REFUSALS
} from './modMemory'

describe('mod memory bodies', () => {
  it('the remember refusals are seven snake_case codes', () => {
    expect(REMEMBER_REFUSALS).toEqual([
      'memory_not_available',
      'remember_empty',
      'remember_too_long',
      'remember_invalid',
      'remember_secret',
      'remember_not_operator',
      'store_write_failed'
    ])
  })

  it('a recall body with a key the mod never sends is refused', () => {
    const ok = { version: 1, window: 0, origin: 'composer', text: 'port' }
    expect(ModMemoryRecallSchema.safeParse(ok).success).toBe(true)
    expect(ModMemoryRecallSchema.safeParse({ ...ok, sessionId: 's1' }).success).toBe(false)
  })

  it('a recall text is 1 to 2,000 characters', () => {
    const body = (text: string): unknown => ({ version: 1, window: 0, origin: 'composer', text })
    expect(
      ['', 'x'.repeat(2000), 'x'.repeat(2001)].map(
        (t) => ModMemoryRecallSchema.safeParse(body(t)).success
      )
    ).toEqual([false, true, false])
  })

  it('at use takes 1 to 5 folders', () => {
    const body = (n: number): unknown => ({
      version: 1,
      window: 3,
      folders: Array.from({ length: n }, (_, i) => `/work/f${i}`)
    })
    expect([0, 1, 5, 6].map((n) => ModMemoryAtUseSchema.safeParse(body(n)).success)).toEqual([
      false,
      true,
      true,
      false
    ])
  })

  it('a window is a whole number from 0', () => {
    expect(
      [-1, 0, 1.5, 7].map(
        (window) => ModMemoryIndexSchema.safeParse({ version: 1, window }).success
      )
    ).toEqual([false, true, false, true])
  })

  it('remember accepts an empty text (main answers remember_empty) and refuses over 8,000', () => {
    const body = (text: string): unknown => ({ version: 1, origin: 'composer', text })
    expect(
      ['', 'x'.repeat(8000), 'x'.repeat(8001)].map(
        (t) => ModMemoryRememberSchema.safeParse(body(t)).success
      )
    ).toEqual([true, true, false])
  })
  it('a window is at most 1,000,000', () => {
    expect(
      [0, 1_000_000, 1_000_001].map(
        (window) => ModMemoryIndexSchema.safeParse({ version: 1, window }).success
      )
    ).toEqual([true, true, false])
  })

  it('an origin is at most 64 characters', () => {
    const body = (origin: string): unknown => ({ version: 1, window: 0, origin, text: 'port' })
    expect(
      ['x'.repeat(64), 'x'.repeat(65)].map((o) => ModMemoryRecallSchema.safeParse(body(o)).success)
    ).toEqual([true, false])
  })

  it('a remember origin is at most 64 characters', () => {
    const body = (origin: string): unknown => ({ version: 1, origin, text: 'port' })
    expect(
      ['x'.repeat(64), 'x'.repeat(65)].map(
        (o) => ModMemoryRememberSchema.safeParse(body(o)).success
      )
    ).toEqual([true, false])
  })

  it('an at-use folder is 1 to 4,096 characters', () => {
    const body = (folder: string): unknown => ({ version: 1, window: 3, folders: [folder] })
    expect(
      ['', 'x'.repeat(4096), 'x'.repeat(4097)].map(
        (f) => ModMemoryAtUseSchema.safeParse(body(f)).success
      )
    ).toEqual([false, true, false])
  })

  it('an index body with a key the mod never sends is refused', () => {
    const ok = { version: 1, window: 0 }
    expect(
      [ok, { ...ok, sessionId: 's1' }].map((b) => ModMemoryIndexSchema.safeParse(b).success)
    ).toEqual([true, false])
  })

  it('an at-use body with a key the mod never sends is refused', () => {
    const ok = { version: 1, window: 0, folders: ['/work/app'] }
    expect(
      [ok, { ...ok, sessionId: 's1' }].map((b) => ModMemoryAtUseSchema.safeParse(b).success)
    ).toEqual([true, false])
  })

  it('a remember body with a key the mod never sends is refused', () => {
    const ok = { version: 1, origin: 'composer', text: 'port' }
    expect(
      [ok, { ...ok, sessionId: 's1' }].map((b) => ModMemoryRememberSchema.safeParse(b).success)
    ).toEqual([true, false])
  })

  it('every body is version 1 only', () => {
    const bodies = [
      [ModMemoryIndexSchema, { window: 0 }],
      [ModMemoryRecallSchema, { window: 0, origin: 'composer', text: 'port' }],
      [ModMemoryAtUseSchema, { window: 0, folders: ['/work/app'] }],
      [ModMemoryRememberSchema, { origin: 'composer', text: 'port' }]
    ] as const
    expect(
      bodies.map(([schema, body]) =>
        [1, 2].map((version) => schema.safeParse({ ...body, version }).success)
      )
    ).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [true, false]
    ])
  })
})
