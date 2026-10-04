import { describe, it, expect } from 'vitest'
import type { BoardSession } from '../../stores/boardStore'
import {
  activeEmptyCopy,
  activeRows,
  deleteConsequence,
  exitResultCopy,
  statusAge
} from './activeSessionsView'

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

describe('activeRows (spec 2026-10-03 D)', () => {
  const all = [
    s('idle-old', 'idle', 1),
    s('work-new', 'working', 9),
    s('need-new', 'needs-you', 8),
    s('work-old', 'working', 2),
    s('need-old', 'needs-you', 3),
    s('other', 'needs-you', 0, 'w2')
  ]

  it('orders Needs you → Working → Idle, oldest first inside each', () => {
    expect(activeRows(all, 'ws:w1', '').map((r) => r.id)).toEqual([
      'need-old',
      'need-new',
      'work-old',
      'work-new',
      'idle-old'
    ])
  })

  it('a workspace scope keeps its own sessions; All keeps every one', () => {
    expect(activeRows(all, 'ws:w2', '').map((r) => r.id)).toEqual(['other'])
    expect(activeRows(all, 'all', '')).toHaveLength(6)
  })

  it('the search matches the NAME, trimmed and case-insensitive', () => {
    expect(activeRows(all, 'all', '  WORK ').map((r) => r.id)).toEqual(['work-old', 'work-new'])
  })
})

describe('activeEmptyCopy', () => {
  it('three nothings, three sentences', () => {
    expect(activeEmptyCopy(0, 0)).toBe('No sessions are running.')
    expect(activeEmptyCopy(4, 0)).toBe('No sessions are running in this workspace.')
    expect(activeEmptyCopy(4, 2)).toBe('No sessions match your search.')
  })
})

describe('statusAge', () => {
  it('is short: now, minutes, hours, days', () => {
    expect(statusAge(0, 59_000)).toBe('now')
    expect(statusAge(0, 4 * 60_000)).toBe('4m')
    expect(statusAge(0, 2 * 3_600_000)).toBe('2h')
    expect(statusAge(0, 3 * 86_400_000)).toBe('3d')
    expect(statusAge(10, 0)).toBe('now') // a clock behind the stamp never goes negative
  })
})

describe('exitResultCopy', () => {
  const ok = (name: string): { id: string; name: string; ok: boolean } => ({
    id: name,
    name,
    ok: true
  })
  const no = (name: string): { id: string; name: string; ok: boolean } => ({
    id: name,
    name,
    ok: false
  })

  it('all landed: success — one by name, several by count', () => {
    expect(exitResultCopy('archive', [ok('api')])).toEqual({
      tone: 'success',
      text: 'Archived "api".'
    })
    expect(exitResultCopy('archive', [ok('a'), ok('b'), ok('c')])).toEqual({
      tone: 'success',
      text: 'Archived 3 sessions.'
    })
    expect(exitResultCopy('delete', [ok('a'), ok('b')]).text).toBe('Deleted 2 sessions.')
  })

  it('partly refused: an error that says both halves', () => {
    expect(exitResultCopy('archive', [ok('a'), ok('b'), no('web')])).toEqual({
      tone: 'error',
      text: 'Archived 2 sessions. Could not archive "web".'
    })
  })

  it('all refused: names every one', () => {
    expect(exitResultCopy('delete', [no('web'), no('api'), no('db')])).toEqual({
      tone: 'error',
      text: 'Could not delete "web", "api" and "db".'
    })
  })
})

describe('deleteConsequence', () => {
  it('is StopConfirm`s sentence, singular or plural', () => {
    expect(deleteConsequence(1)).toBe(
      "The session is stopped and nothing is kept in Past sessions. Claude's own files are not touched."
    )
    expect(deleteConsequence(3)).toBe(
      "The sessions are stopped and nothing is kept in Past sessions. Claude's own files are not touched."
    )
  })
})
