// Goal schema rules the mutation run (StrykerJS) showed no test pinned: the one-line helpers the
// name, title and check schemas are built on, and a proposal keeping its fields.
import { describe, it, expect } from 'vitest'
import { GoalNameSchema, TaskCheckSchema, ProposalSchema } from './goal'

describe('the one-line goal fields', () => {
  it('a goal name is trimmed', () => {
    expect(GoalNameSchema.parse('  Ship v2  ')).toBe('Ship v2')
  })

  it('a task check is trimmed', () => {
    expect(TaskCheckSchema.parse('  npm test  ')).toBe('npm test')
  })

  it('a blank task check is refused', () => {
    expect(TaskCheckSchema.safeParse('   ').success).toBe(false)
  })
})

describe('ProposalSchema', () => {
  it('keeps the planner, the goal and the groups of a proposal', () => {
    const proposal = {
      plannerSessionId: 'planner-1',
      goalId: 'goal-1',
      groups: [{ taskIds: ['task-1'], note: 'first' }]
    }
    expect(ProposalSchema.parse(proposal)).toEqual(proposal)
  })
})
