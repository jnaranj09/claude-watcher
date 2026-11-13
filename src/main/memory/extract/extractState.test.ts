// How far each session's transcript was read for memory (memory phase 2): one row per transcript,
// keyed by its own id, that follows the card's id across `/clear`. Real `:memory:` db.
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NO_COUNTS, type MemoryItem } from '../../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import { openMemoryDb, type MemoryDb } from '../memoryDb'
import { createExtractState, type ExtractState } from './extractState'

const NOW = 1_762_800_000_000

let db: MemoryDb
let state: ExtractState

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  db = open.db
  state = createExtractState({ db })
})

const META: MemoryItem['meta'] = {
  folder: '/work/app',
  sessionName: 'build',
  tagIds: ['t1'],
  templateId: null,
  goalId: 'g1',
  taskIds: []
}

function track(
  sessionId: string,
  over: { origin?: string; workspaceId?: string; phase?: 'live' | 'ending'; at?: number } = {}
): void {
  state.track({
    sessionId,
    originSessionId: over.origin ?? sessionId,
    workspaceId: over.workspaceId ?? 'w1',
    meta: META,
    phase: over.phase ?? 'live',
    at: over.at ?? NOW
  })
}

const STEP = {
  byteOffset: 100,
  entryCount: 4,
  prompts: 2,
  note: 'set up the port' as string | null,
  added: { specifics: 1, facts: 0, tasks: 1, episodes: 0 },
  episodeId: null as string | null,
  at: NOW + 1
}

describe('track', () => {
  it('a new row starts at offset 0 with no notes and zero counts', () => {
    expect(
      state.track({
        sessionId: 's1',
        originSessionId: 'c1',
        workspaceId: 'w1',
        meta: META,
        phase: 'live',
        at: NOW
      })
    ).toEqual({
      sessionId: 's1',
      originSessionId: 'c1',
      workspaceId: 'w1',
      meta: META,
      byteOffset: 0,
      entryCount: 0,
      prompts: 0,
      notes: [],
      phase: 'live',
      attempts: 0,
      counts: NO_COUNTS,
      episodeId: null,
      updatedAt: NOW
    })
    expect(state.get('s1')?.originSessionId).toBe('c1')
  })

  it('track keeps the offset and the notes of a row that is already there', () => {
    track('s1')
    state.advance('s1', { ...STEP, episodeId: 'e1' })
    const meta = { ...META, sessionName: 'renamed' }
    const row = state.track({
      sessionId: 's1',
      originSessionId: 'c2',
      workspaceId: 'w2',
      meta,
      phase: 'ending',
      at: NOW + 9
    })
    expect(row).toEqual({
      sessionId: 's1',
      originSessionId: 'c2',
      workspaceId: 'w2',
      meta,
      byteOffset: 100,
      entryCount: 4,
      prompts: 2,
      notes: ['set up the port'],
      phase: 'ending',
      attempts: 0,
      counts: { specifics: 1, facts: 0, tasks: 1, episodes: 0 },
      episodeId: 'e1',
      updatedAt: NOW + 9
    })
    expect(state.get('s1')).toEqual(row)
  })

  it('get of an unknown session is null', () => {
    expect(state.get('nope')).toBeNull()
  })
})

describe('advance and failed', () => {
  it('advance sums the counts, appends the note and keeps the newest 20 notes', () => {
    track('s1')
    for (let i = 0; i < EXTRACT_LIMITS.notesKept + 2; i += 1) {
      state.advance('s1', { ...STEP, byteOffset: 100 * (i + 1), note: `n${i}`, at: NOW + i })
    }
    const row = state.get('s1')
    expect(row?.notes).toHaveLength(20)
    expect([row?.notes[0], row?.notes[19]]).toEqual(['n2', 'n21'])
    expect(row).toMatchObject({
      byteOffset: 2200,
      counts: { specifics: 22, facts: 0, tasks: 22, episodes: 0 },
      updatedAt: NOW + 21
    })
  })

  it('advance with no note keeps the notes, resets attempts and keeps the episode id on null', () => {
    track('s1')
    state.advance('s1', { ...STEP, episodeId: 'e1' })
    expect(state.failed('s1', NOW + 2)).toBe(1)
    expect(state.failed('s1', NOW + 3)).toBe(2)
    state.advance('s1', {
      ...STEP,
      byteOffset: 200,
      entryCount: 9,
      prompts: 3,
      note: null,
      episodeId: null,
      at: NOW + 4
    })
    expect(state.get('s1')).toMatchObject({
      byteOffset: 200,
      entryCount: 9,
      prompts: 3,
      notes: ['set up the port'],
      attempts: 0,
      episodeId: 'e1'
    })
    state.advance('s1', { ...STEP, episodeId: 'e2' })
    expect(state.get('s1')?.episodeId).toBe('e2')
  })

  it('failed counts up and stamps the time', () => {
    track('s1')
    expect(state.failed('s1', NOW + 5)).toBe(1)
    expect(state.get('s1')).toMatchObject({ attempts: 1, updatedAt: NOW + 5 })
  })

  it('advance and failed on an unknown session throw and write nothing', () => {
    expect(() => state.advance('nope', STEP)).toThrow('extract_state_not_found')
    expect(() => state.failed('nope', NOW)).toThrow('extract_state_not_found')
    expect(state.pending()).toEqual([])
  })

  it('setPhase on an unknown session does nothing and makes no row', () => {
    track('s1')
    const before = state.pending()
    expect(() => state.setPhase('nope', 'done', NOW + 9)).not.toThrow()
    expect(state.get('nope')).toBeNull()
    expect(state.pending()).toEqual(before)
    expect(db.get('SELECT COUNT(*) AS n FROM extract_state', z.object({ n: z.number() }))).toEqual({
      n: 1
    })
  })
})

describe('phases', () => {
  it('pending lists live and ending rows, never done ones', () => {
    track('s1', { at: NOW + 3 })
    track('s2', { phase: 'ending', at: NOW + 1 })
    track('s3', { at: NOW + 2 })
    state.setPhase('s3', 'done', NOW + 4)
    expect(state.get('s3')).toMatchObject({ phase: 'done', updatedAt: NOW + 4 })
    expect(state.pending().map((r) => r.sessionId)).toEqual(['s2', 's1'])
  })
})

describe('remove and rebind', () => {
  it('remove takes a row by its transcript id or by its card id', () => {
    track('s1', { origin: 'c1' })
    track('s2', { origin: 'c1' })
    track('s3', { origin: 'c3' })
    track('s4', { origin: 'c4' })
    expect(state.remove('c1').sort()).toEqual(['s1', 's2'])
    expect(state.remove('s3')).toEqual(['s3'])
    expect(state.remove('nope')).toEqual([])
    expect([state.get('s1'), state.get('s2'), state.get('s3'), state.get('s4')?.sessionId]).toEqual(
      [null, null, null, 's4']
    )
  })

  it('removeByWorkspace takes the rows of that workspace only', () => {
    track('s1')
    track('s2', { workspaceId: 'w2' })
    expect(state.removeByWorkspace('w1')).toEqual(['s1'])
    expect([state.get('s1'), state.get('s2')?.sessionId]).toEqual([null, 's2'])
  })

  it('/clear moves the card id of a row, not its transcript id', () => {
    track('s1', { origin: 'c1' })
    track('s2', { origin: 'c2' })
    state.rebindOrigin('c1', 'c9')
    expect(state.get('s1')).toMatchObject({ sessionId: 's1', originSessionId: 'c9' })
    expect(state.get('s2')?.originSessionId).toBe('c2')
  })

  it('a row whose JSON column fails its schema throws on read', () => {
    track('s1')
    db.run(`UPDATE extract_state SET counts = '{"specifics":-1}' WHERE session_id = 's1'`)
    expect(() => state.get('s1')).toThrow('memory_db_row_invalid')
  })
})
