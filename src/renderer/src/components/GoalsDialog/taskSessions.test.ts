import { describe, it, expect } from 'vitest'
import type { PastSession } from '../../../../shared/ipc/contract'
import type { Task } from '../../../../shared/schemas/goal'
import type { BoardSession } from '../../stores/boardStore'
import { goalSessions, linkCandidates, liveLinked } from './taskSessions'

const s = (
  id: string,
  column: BoardSession['column'],
  enteredColumnAt: number,
  workspaceId = 'w1'
): BoardSession => ({
  id,
  sessionName: id,
  projectPath: `/p/${id}`,
  status: 'x',
  pid: 1,
  column,
  enteredColumnAt,
  workspaceId,
  tagIds: []
})

const task = (sessionIds: string[]): Task => ({
  id: 't1',
  workspaceId: 'w1',
  goalId: null,
  title: 'write',
  status: 'open',
  sessionIds,
  createdAt: 1,
  doneAt: null,
  doneBy: null,
  check: null,
  leftWith: null,
  lastSeenAt: null,
  report: null,
  originSessionId: null,
  folder: null,
  touchedBy: []
})

describe('linkCandidates', () => {
  it("keeps the live sessions of the task's workspace not yet linked, needs-you first", () => {
    const sessions = [
      s('idle', 'idle', 1),
      s('need', 'needs-you', 5),
      s('linked', 'working', 2),
      s('elsewhere', 'working', 0, 'w2')
    ]
    expect(linkCandidates(task(['linked']), sessions).map((x) => x.id)).toEqual(['need', 'idle'])
  })
})

describe('liveLinked', () => {
  it('skips a linked id with no live session', () => {
    const byId = { s2: s('s2', 'working', 1) }
    expect(liveLinked(task(['gone', 's2']), byId).map((x) => x.id)).toEqual(['s2'])
  })

  it('keeps a linked session that moved to another workspace', () => {
    const byId = { s2: s('s2', 'working', 1, 'w2') }
    expect(liveLinked(task(['s2']), byId).map((x) => x.id)).toEqual(['s2'])
  })
})

describe('goalSessions', () => {
  const touched = (id: string, title: string, touchedBy: Task['touchedBy']): Task => ({
    ...task([]),
    id,
    title,
    touchedBy
  })
  const record = (id: string, name: string): PastSession => ({
    id,
    name,
    cwd: '/p',
    workspaceId: 'w1',
    tagIds: [],
    launchedAt: 1,
    endedAt: 2
  })
  const tasks = [
    touched('t-a', 'Alpha', [
      { sessionId: 'past', at: 10 },
      { sessionId: 'live', at: 30 }
    ]),
    touched('t-b', 'Beta', [
      { sessionId: 'past', at: 20 },
      { sessionId: 'gone', at: 5 }
    ]),
    touched('t-c', 'Gamma', [{ sessionId: 'tie-b', at: 1 }]),
    touched('t-d', 'Delta', [{ sessionId: 'tie-a', at: 1 }])
  ]
  const live = s('live', 'working', 1)

  it('lists sessions by last touch, newest first, ties by id, each with its titles newest first', () => {
    const rows = goalSessions(tasks, { live }, [record('past', 'Fix login')])
    expect(rows.map((r) => [r.id, r.taskTitles])).toEqual([
      ['live', ['Alpha']],
      ['past', ['Beta', 'Alpha']],
      ['gone', ['Beta']],
      ['tie-a', ['Delta']],
      ['tie-b', ['Gamma']]
    ])
  })

  it('says which place knows each session: the live card (with it), a record, or neither', () => {
    const rows = goalSessions(tasks, { live }, [record('past', 'Fix login')])
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get('live')).toMatchObject({ state: 'live', name: 'live', session: live })
    expect(byId.get('past')).toMatchObject({ state: 'past', name: 'Fix login', session: null })
    expect(byId.get('gone')).toMatchObject({ state: 'gone', name: null, session: null })
  })

  it('a session neither live nor checked is unknown while the records are not loaded', () => {
    const rows = goalSessions(tasks, { live }, null)
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ['live', 'live'],
      ['past', 'unknown'],
      ['gone', 'unknown'],
      ['tie-a', 'unknown'],
      ['tie-b', 'unknown']
    ])
    expect(rows[1]).toMatchObject({ name: null, session: null, taskTitles: ['Beta', 'Alpha'] })
  })

  it('no touches, no rows', () => {
    expect(goalSessions([task([])], { live }, [])).toEqual([])
  })
})
