import { describe, it, expect } from 'vitest'
import type { Task } from '../../../../shared/schemas/goal'
import type { BoardSession } from '../../stores/boardStore'
import { linkCandidates, liveLinked } from './taskSessions'

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
