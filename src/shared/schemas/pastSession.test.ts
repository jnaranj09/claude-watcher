import { describe, it, expect } from 'vitest'
import {
  PAST_SESSIONS_FILE_VERSION,
  PAST_SESSIONS_MAX,
  PastSessionSchema,
  PastSessionsFileSchema
} from './pastSession'

const ROW = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'billing api',
  cwd: '/home/op/work/api',
  workspaceId: 'default',
  tagIds: ['t1'],
  launchedAt: 1_000,
  endedAt: 2_000
}

describe('PastSessionSchema', () => {
  it('round-trips a record', () => {
    expect(PastSessionSchema.parse(ROW)).toEqual(ROW)
  })
  it('defaults tagIds to [] (additive field rule)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tagIds: _drop, ...noTags } = ROW
    expect(PastSessionSchema.parse(noTags).tagIds).toEqual([])
  })
  it('an old record without tasksMarkDone reads as off', () => {
    expect(PastSessionSchema.parse(ROW).tasksMarkDone).toBeUndefined()
    expect(PastSessionSchema.parse({ ...ROW, tasksMarkDone: true }).tasksMarkDone).toBe(true)
    expect(PastSessionSchema.safeParse({ ...ROW, tasksMarkDone: false }).success).toBe(false)
  })
  it('is STRICT — an extra key fails closed (state only, never content)', () => {
    expect(PastSessionSchema.safeParse({ ...ROW, latestMessage: 'x' }).success).toBe(false)
  })
  it('fails a control character in the name and a blank id / cwd / workspace', () => {
    const bell = String.fromCharCode(7)
    expect(PastSessionSchema.safeParse({ ...ROW, name: `a${bell}b` }).success).toBe(false)
    expect(PastSessionSchema.safeParse({ ...ROW, id: '' }).success).toBe(false)
    expect(PastSessionSchema.safeParse({ ...ROW, cwd: '' }).success).toBe(false)
    expect(PastSessionSchema.safeParse({ ...ROW, workspaceId: '' }).success).toBe(false)
  })
  it('trims the name at the boundary like every session name', () => {
    expect(PastSessionSchema.parse({ ...ROW, name: '  x ' }).name).toBe('x')
  })
  it('a record written before the memory field loads, and one with it loads', () => {
    expect(PastSessionSchema.parse(ROW).memory).toBeUndefined()
    expect(
      PastSessionSchema.parse({ ...ROW, memory: { state: 'saved', facts: 2 } }).memory
    ).toEqual({ state: 'saved', specifics: 0, facts: 2, tasks: 0, episodes: 0, episodeId: null })
  })
  it('the memory field is strict and holds no negative count', () => {
    expect(
      PastSessionSchema.safeParse({ ...ROW, memory: { state: 'off', note: 'x' } }).success
    ).toBe(false)
    expect(
      PastSessionSchema.safeParse({ ...ROW, memory: { state: 'saved', facts: -1 } }).success
    ).toBe(false)
  })
  it('file: version 1, a list of records; the cap is 200', () => {
    expect(PAST_SESSIONS_FILE_VERSION).toBe(1)
    expect(PAST_SESSIONS_MAX).toBe(200)
    expect(PastSessionsFileSchema.safeParse({ version: 1, sessions: [ROW] }).success).toBe(true)
    expect(PastSessionsFileSchema.safeParse({ version: 2, sessions: [] }).success).toBe(false)
  })
})
