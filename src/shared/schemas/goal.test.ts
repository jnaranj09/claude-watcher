import { describe, it, expect } from 'vitest'
import {
  GoalsFileSchema,
  GoalSaveSchema,
  GoalsStartSchema,
  ProposalDecideSchema,
  TASK_REPEATED,
  TaskSaveSchema,
  TaskSchema,
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
})
