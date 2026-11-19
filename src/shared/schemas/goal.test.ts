import { describe, it, expect } from 'vitest'
import {
  GoalSaveToFileSchema,
  GoalSchema,
  GoalsFileSchema,
  GoalsViewSchema,
  GoalSaveSchema,
  GoalsStartSchema,
  ProposalDecideSchema,
  TASK_REPEATED,
  TaskSaveSchema,
  TaskCheckSchema,
  TaskReportSchema,
  TaskSchema,
  TASK_CHECK_MAX,
  TASK_REPORT_EVIDENCE_MAX,
  TASK_TITLE_MAX
} from './goal'

const TASK_SAVE = { workspaceId: 'w1', goalId: null, title: 'Write the tests' }

describe('goal schemas', () => {
  it('rejects a title with a newline', () => {
    expect(TaskSaveSchema.safeParse({ ...TASK_SAVE, title: 'one\ntwo' }).success).toBe(false)
  })

  it('rejects a 201-char title and accepts the 200-char one, trimmed first', () => {
    expect(TaskSaveSchema.safeParse({ ...TASK_SAVE, title: 'x'.repeat(201) }).success).toBe(false)
    const ok = TaskSaveSchema.safeParse({ ...TASK_SAVE, title: ` ${'x'.repeat(TASK_TITLE_MAX)} ` })
    expect(ok.success).toBe(true)
  })

  it('rejects a blank title and a blank goal name', () => {
    expect(TaskSaveSchema.safeParse({ ...TASK_SAVE, title: '   ' }).success).toBe(false)
    expect(GoalSaveSchema.safeParse({ workspaceId: 'w1', name: '' }).success).toBe(false)
  })

  it('reads a task written without sessionIds as []', () => {
    const task = TaskSchema.parse({
      id: 't1',
      workspaceId: 'w1',
      title: 'a',
      status: 'open',
      createdAt: 1
    })
    expect(task.sessionIds).toEqual([])
    expect(task.goalId).toBeNull()
    expect(task.doneAt).toBeNull()
    expect(task.doneBy).toBeNull()
  })

  it('a GoalsStart with 11 groups fails, and 10 pass', () => {
    const groups = (n: number): { taskIds: string[] }[] =>
      Array.from({ length: n }, (_, i) => ({ taskIds: [`t${i}`] }))
    const req = (n: number): unknown => ({
      workspaceId: 'w1',
      goalId: null,
      groups: groups(n),
      markDone: true
    })
    expect(GoalsStartSchema.safeParse(req(11)).success).toBe(false)
    expect(GoalsStartSchema.safeParse(req(10)).success).toBe(true)
    expect(GoalsStartSchema.safeParse(req(0)).success).toBe(false)
  })

  it('a task id twice across groups, or twice in one, fails with a code only', () => {
    const req = (groups: string[][]): unknown => ({
      workspaceId: 'w1',
      goalId: null,
      groups: groups.map((taskIds) => ({ taskIds })),
      markDone: true
    })
    const across = GoalsStartSchema.safeParse(
      req([
        ['t1', 't2'],
        ['t3', 't1']
      ])
    )
    expect(across.success).toBe(false)
    expect(across.error?.issues).toEqual([
      expect.objectContaining({ message: TASK_REPEATED, path: ['groups', 1, 'taskIds', 1] })
    ])
    expect(GoalsStartSchema.safeParse(req([['t1', 't1']])).success).toBe(false)
    expect(
      ProposalDecideSchema.safeParse({
        plannerSessionId: 'p',
        decision: 'accept',
        groups: [{ taskIds: ['t1'] }, { taskIds: ['t1'] }],
        markDone: true
      }).success
    ).toBe(false)
    expect(GoalsStartSchema.safeParse(req([['t1'], ['t2']])).success).toBe(true)
  })

  it('a proposal decision: Accept needs its groups, Reject carries nothing else', () => {
    const accept = { plannerSessionId: 'p', decision: 'accept', markDone: true }
    expect(ProposalDecideSchema.safeParse(accept).success).toBe(false)
    expect(
      ProposalDecideSchema.safeParse({ ...accept, groups: [{ taskIds: ['t1'] }] }).success
    ).toBe(true)
    expect(
      ProposalDecideSchema.safeParse({ plannerSessionId: 'p', decision: 'reject' }).success
    ).toBe(true)
    expect(
      ProposalDecideSchema.safeParse({ plannerSessionId: 'p', decision: 'reject', markDone: true })
        .success
    ).toBe(false)
  })

  it('requests are strict (an extra key fails)', () => {
    expect(TaskSaveSchema.safeParse({ ...TASK_SAVE, cwd: '/etc' }).success).toBe(false)
    expect(
      GoalSaveSchema.safeParse({ workspaceId: 'w1', name: 'g', defaultCwd: '/x' }).success
    ).toBe(false)
  })

  it('the file schema is versioned 1', () => {
    expect(GoalsFileSchema.safeParse({ version: 2, goals: [], tasks: [] }).success).toBe(false)
    expect(GoalsFileSchema.safeParse({ version: 1, goals: [], tasks: [] }).success).toBe(true)
  })

  it('reads a goal written before saveToFile as off', () => {
    const goal = GoalSchema.parse({ id: 'g1', workspaceId: 'w1', name: 'g', createdAt: 1 })
    expect(goal.saveToFile).toBe(false)
  })

  it('the save-to-file request is strict (never carries a path)', () => {
    expect(GoalSaveToFileSchema.safeParse({ goalId: 'g1', on: true }).success).toBe(true)
    expect(GoalSaveToFileSchema.safeParse({ goalId: 'g1', on: true, path: '/x' }).success).toBe(
      false
    )
  })

  it('a view refuses a file problem code outside the list', () => {
    const view = { goals: [], tasks: [], proposals: [] }
    expect(
      GoalsViewSchema.safeParse({
        ...view,
        fileProblems: [{ goalId: 'g1', code: 'folder_missing' }]
      }).success
    ).toBe(true)
    expect(
      GoalsViewSchema.safeParse({ ...view, fileProblems: [{ goalId: 'g1', code: 'nope' }] }).success
    ).toBe(false)
  })

  it('a goals file written before the six fields loads with null for each', () => {
    const file = GoalsFileSchema.parse({
      version: 1,
      goals: [],
      tasks: [{ id: 't1', workspaceId: 'w1', title: 'a', status: 'open', createdAt: 1 }]
    })
    expect(file.tasks[0]).toMatchObject({
      check: null,
      leftWith: null,
      lastSeenAt: null,
      report: null,
      originSessionId: null,
      folder: null
    })
  })

  it('a check is one trimmed line of at most 300 characters with no control characters', () => {
    expect(TaskCheckSchema.parse(' grep -n sandbox config/app.yml ')).toBe(
      'grep -n sandbox config/app.yml'
    )
    expect(TaskCheckSchema.safeParse('x'.repeat(TASK_CHECK_MAX)).success).toBe(true)
    expect(TaskCheckSchema.safeParse('x'.repeat(TASK_CHECK_MAX + 1)).success).toBe(false)
    expect(TaskCheckSchema.safeParse('one\ntwo').success).toBe(false)
    expect(TaskCheckSchema.safeParse('  ').success).toBe(false)
  })

  it('a report needs a session id and one line of evidence of at most 300 characters', () => {
    const report = { at: 1, sessionId: 's1', sessionName: 'fix api port', outcome: 'done' }
    const ok = TaskReportSchema.safeParse({
      ...report,
      evidence: 'x'.repeat(TASK_REPORT_EVIDENCE_MAX)
    })
    expect(ok.success).toBe(true)
    const long = 'x'.repeat(TASK_REPORT_EVIDENCE_MAX + 1)
    expect(TaskReportSchema.safeParse({ ...report, evidence: long }).success).toBe(false)
    expect(TaskReportSchema.safeParse({ ...report, evidence: 'a\tb' }).success).toBe(false)
    expect(TaskReportSchema.safeParse({ ...report, evidence: 'seen', sessionId: '' }).success).toBe(
      false
    )
    expect(
      TaskReportSchema.safeParse({ ...report, evidence: 'seen', outcome: 'maybe' }).success
    ).toBe(false)
  })

  it('a task refuses an empty folder and an empty origin session id', () => {
    const task = { id: 't1', workspaceId: 'w1', title: 'a', status: 'open', createdAt: 1 }
    expect(TaskSchema.safeParse({ ...task, folder: '/work/acme/shop' }).success).toBe(true)
    expect(TaskSchema.safeParse({ ...task, folder: '' }).success).toBe(false)
    expect(TaskSchema.safeParse({ ...task, originSessionId: 's1' }).success).toBe(true)
    expect(TaskSchema.safeParse({ ...task, originSessionId: '' }).success).toBe(false)
  })

  it('a v1 file with none of the memory-session fields parses with the defaults', () => {
    const file = GoalsFileSchema.parse({
      version: 1,
      goals: [{ id: 'g1', workspaceId: 'w1', name: 'Ship', createdAt: 1 }],
      tasks: [{ id: 't1', workspaceId: 'w1', title: 'a', status: 'open', createdAt: 1 }]
    })
    expect(file.goals[0]?.memorySessionIds).toEqual([])
    expect(file.tasks[0]?.touchedBy).toEqual([])
    expect(file.sessionLineage).toEqual([])
    expect(file.plannerSessions).toEqual([])
    expect(file.memoryRegroupedAt).toBeNull()
  })

  it('a file with the memory-session fields keeps them', () => {
    const file = GoalsFileSchema.parse({
      version: 1,
      goals: [
        { id: 'g1', workspaceId: 'w1', name: 'Ship', createdAt: 1, memorySessionIds: ['s1'] }
      ],
      tasks: [
        {
          id: 't1',
          workspaceId: 'w1',
          title: 'a',
          status: 'open',
          createdAt: 1,
          touchedBy: [{ sessionId: 's1', at: 5 }]
        }
      ],
      sessionLineage: [{ fromId: 's1', toId: 's2', at: 6 }],
      plannerSessions: [{ sessionId: 'p1', goalId: 'g1', at: 7 }],
      memoryRegroupedAt: 8
    })
    expect(file.goals[0]?.memorySessionIds).toEqual(['s1'])
    expect(file.tasks[0]?.touchedBy).toEqual([{ sessionId: 's1', at: 5 }])
    expect(file.sessionLineage).toEqual([{ fromId: 's1', toId: 's2', at: 6 }])
    expect(file.plannerSessions).toEqual([{ sessionId: 'p1', goalId: 'g1', at: 7 }])
    expect(file.memoryRegroupedAt).toBe(8)
  })

  it('a touchedBy of 25 entries still parses: the cap is the store, not the schema', () => {
    const touchedBy = Array.from({ length: 25 }, (_, i) => ({ sessionId: `s${i}`, at: i }))
    const task = TaskSchema.safeParse({
      id: 't1',
      workspaceId: 'w1',
      title: 'a',
      status: 'open',
      createdAt: 1,
      touchedBy
    })
    expect(task.success).toBe(true)
    expect(task.data?.touchedBy).toHaveLength(25)
  })
})
