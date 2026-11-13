// The commands that worked (memory phase 2): one counted row per workspace, folder and text, the
// newest 2,000 of a workspace kept. Real `:memory:` db; each write is checked in the table.
import { beforeEach, describe, expect, it } from 'vitest'
import { EXTRACT_LIMITS } from '../../shared/schemas/memoryExtract'
import { MEMORY_ERROR } from '../../shared/schemas/memory'
import { createMemoryCommands, type MemoryCommands } from './memoryCommands'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import { z } from 'zod'

const NOW = 1_762_800_000_000

let db: MemoryDb
let ids: number
let commands: MemoryCommands

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  db = open.db
  ids = 0
  commands = createMemoryCommands({ db, newId: () => `c${++ids}` })
})

const ALL = { query: null, folder: null, offset: 0, limit: 100 }

function run(
  text: string,
  over: { folder?: string; workspaceId?: string; sessionId?: string; at?: number } = {}
): void {
  commands.record({
    workspaceId: over.workspaceId ?? 'w1',
    folder: over.folder ?? '/work/app',
    text,
    sessionId: over.sessionId ?? 's1',
    at: over.at ?? NOW
  })
}

const SessionCols = z.object({
  last_session_id: z.string(),
  session_deleted_at: z.number().nullable()
})

function sessionOf(id: string): z.infer<typeof SessionCols> | null {
  return db.get(
    'SELECT last_session_id, session_deleted_at FROM command WHERE id = ?',
    SessionCols,
    [id]
  )
}

describe('record', () => {
  it('the same command in the same folder is one row with a count of 2', () => {
    run('npm test', { at: NOW })
    run('npm test', { at: NOW + 5, sessionId: 's2' })
    expect(commands.list('w1', ALL)).toEqual({
      total: 1,
      rows: [
        {
          id: 'c1',
          workspaceId: 'w1',
          folder: '/work/app',
          text: 'npm test',
          count: 2,
          lastAt: NOW + 5,
          sessionDeletedAt: null
        }
      ]
    })
    expect(sessionOf('c1')?.last_session_id).toBe('s2')
  })

  it('the same text in another folder is its own row', () => {
    run('npm test', { at: NOW })
    run('npm test', { folder: '/work/web', at: NOW + 1 })
    run('npm test', { workspaceId: 'w2', at: NOW + 2 })
    expect(commands.list('w1', ALL).rows.map((r) => [r.folder, r.count])).toEqual([
      ['/work/web', 1],
      ['/work/app', 1]
    ])
    expect(commands.list('w2', ALL).total).toBe(1)
  })

  it('keeps the newest 2,000 commands of a workspace', () => {
    run('other workspace', { workspaceId: 'w2', at: NOW - 1 })
    for (let i = 0; i <= EXTRACT_LIMITS.commandsPerWorkspace; i += 1)
      run(`cmd ${i}`, { at: NOW + i })
    const out = commands.list('w1', {
      ...ALL,
      limit: 1,
      offset: EXTRACT_LIMITS.commandsPerWorkspace - 1
    })
    expect(out.total).toBe(2000)
    expect(out.rows.map((r) => r.text)).toEqual(['cmd 1'])
    expect(
      db.get("SELECT COUNT(*) AS n FROM command WHERE text = 'cmd 0'", z.object({ n: z.number() }))
    ).toEqual({ n: 0 })
    expect(commands.list('w2', ALL).total).toBe(1)
  })
})

describe('list', () => {
  it('a query matches every term anywhere in the text, with % and _ taken literally', () => {
    run('npm run test_unit', { at: NOW })
    run('NPM RUN build', { at: NOW + 1 })
    run('grep 50% log', { at: NOW + 2 })
    run('npm runtest', { at: NOW + 3 })
    run('grep 50x log', { at: NOW + 4 })
    const texts = (query: string): string[] =>
      commands.list('w1', { ...ALL, query }).rows.map((r) => r.text)
    expect(texts('run npm')).toEqual(['npm runtest', 'NPM RUN build', 'npm run test_unit'])
    expect(texts('test_')).toEqual(['npm run test_unit'])
    expect(texts('50%')).toEqual(['grep 50% log'])
    expect(texts('  ')).toEqual([
      'grep 50x log',
      'npm runtest',
      'grep 50% log',
      'NPM RUN build',
      'npm run test_unit'
    ])
  })

  it('a folder lists that folder and below it on a path boundary', () => {
    run('a', { folder: '/work/app', at: NOW })
    run('b', { folder: '/work/app/web', at: NOW + 1 })
    run('c', { folder: '/work/apple', at: NOW + 2 })
    run('d', { folder: '/work', at: NOW + 3 })
    expect(commands.list('w1', { ...ALL, folder: '/work/app' }).rows.map((r) => r.text)).toEqual([
      'b',
      'a'
    ])
  })

  it('offset and limit page the newest first, total counts every match', () => {
    for (let i = 0; i < 5; i += 1) run(`cmd ${i}`, { at: NOW + i })
    expect(commands.list('w1', { ...ALL, offset: 1, limit: 2 })).toMatchObject({
      total: 5,
      rows: [{ text: 'cmd 3' }, { text: 'cmd 2' }]
    })
  })
})

describe('remove and sessions', () => {
  it('remove deletes the row; an unknown id is refused', () => {
    run('npm test')
    run('npm run build')
    commands.remove('c1')
    expect(commands.list('w1', ALL).rows.map((r) => r.id)).toEqual(['c2'])
    expect(() => commands.remove('c1')).toThrow(MEMORY_ERROR.commandNotFound)
  })

  it('removeByWorkspace deletes only that workspace and answers how many', () => {
    run('a')
    run('b')
    run('c', { workspaceId: 'w2' })
    expect(commands.removeByWorkspace('w1')).toBe(2)
    expect([commands.list('w1', ALL).total, commands.list('w2', ALL).total]).toEqual([0, 1])
  })

  it('a deleted session marks its commands and a later run clears the mark', () => {
    run('npm test', { sessionId: 's1' })
    run('npm run build', { sessionId: 's2' })
    expect(commands.markSessionDeleted('s1', NOW + 10)).toBe(1)
    expect(sessionOf('c1')?.session_deleted_at).toBe(NOW + 10)
    expect(sessionOf('c2')?.session_deleted_at).toBeNull()
    expect(commands.markSessionDeleted('s1', NOW + 20)).toBe(0)
    expect(sessionOf('c1')?.session_deleted_at).toBe(NOW + 10)
    run('npm test', { sessionId: 's3', at: NOW + 30 })
    expect(sessionOf('c1')).toEqual({ last_session_id: 's3', session_deleted_at: null })
  })

  it('rebindSession moves the last session id of its rows', () => {
    run('npm test', { sessionId: 's1' })
    run('npm run build', { sessionId: 's2' })
    commands.rebindSession('s1', 's9')
    expect([sessionOf('c1')?.last_session_id, sessionOf('c2')?.last_session_id]).toEqual([
      's9',
      's2'
    ])
  })
})
