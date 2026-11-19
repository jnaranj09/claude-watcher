// Going back to the build before memory session goals (4f7535b, the commit before it): the goals
// file the memory-session-goals build writes must still parse with the schemas that build reads it
// with. They are plain `z.object`s (not `.strict()`), so the old build keeps every goal and task
// and drops the keys it does not know (`memorySessionIds`, `touchedBy`, `sessionLineage`,
// `plannerSessions`, `memoryRegroupedAt`) at its next write.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createGoalsStore, type GoalsBlobStore } from './goals'
import {
  GoalNameSchema,
  TASK_DONE_BY,
  TASK_LEFT_WITH,
  TaskCheckSchema,
  TaskReportSchema,
  TaskStatusValueSchema,
  TaskTitleSchema
} from '../../shared/schemas/goal'
import { WorkspaceIdSchema } from '../../shared/schemas/workspace'

// FROZEN copies of `GoalSchema`, `TaskSchema` and `GoalsFileSchema` at 4f7535b
// (`src/shared/schemas/goal.ts`). The helper schemas they use are unchanged since. Never update
// them to follow the current schema: their point is that they do not.
const Phase3GoalSchema = z.object({
  id: z.string().min(1),
  workspaceId: WorkspaceIdSchema,
  name: GoalNameSchema,
  defaultCwd: z.string().min(1).nullable().default(null),
  saveToFile: z.boolean().default(false),
  createdAt: z.number()
})
const Phase3TaskSchema = z.object({
  id: z.string().min(1),
  workspaceId: WorkspaceIdSchema,
  goalId: z.string().nullable().default(null),
  title: TaskTitleSchema,
  status: TaskStatusValueSchema,
  sessionIds: z.array(z.string().min(1)).default([]),
  createdAt: z.number(),
  doneAt: z.number().nullable().default(null),
  doneBy: z.enum(TASK_DONE_BY).nullable().default(null),
  check: TaskCheckSchema.nullable().default(null),
  leftWith: z.enum(TASK_LEFT_WITH).nullable().default(null),
  lastSeenAt: z.number().nullable().default(null),
  report: TaskReportSchema.nullable().default(null),
  originSessionId: z.string().min(1).nullable().default(null),
  folder: z.string().min(1).nullable().default(null)
})
const Phase3GoalsFileSchema = z.object({
  version: z.literal(1),
  goals: z.array(Phase3GoalSchema),
  tasks: z.array(Phase3TaskSchema)
})

describe('going back to the build before memory session goals', () => {
  it('parses a goals file with the memory-session fields and loses only those', () => {
    let value: unknown = {
      version: 1,
      goals: [
        { id: 'g1', workspaceId: 'w1', name: 'Auth', createdAt: 1, memorySessionIds: ['s1'] }
      ],
      tasks: [
        {
          id: 't1',
          workspaceId: 'w1',
          goalId: 'g1',
          title: 'Add login',
          status: 'open',
          createdAt: 1,
          touchedBy: [{ sessionId: 's1', at: 2 }]
        }
      ],
      sessionLineage: [{ fromId: 's1', toId: 's2', at: 3 }],
      plannerSessions: [{ sessionId: 'p1', goalId: 'g1', at: 4 }],
      memoryRegroupedAt: 5
    }
    const blobStore: GoalsBlobStore = {
      read: () => value,
      write: (next) => {
        value = next
      },
      backup: () => undefined
    }
    createGoalsStore({ blobStore, log: () => undefined })
    // Today's store wrote the new fields back.
    expect(value).toMatchObject({ memoryRegroupedAt: 5, sessionLineage: [{ toId: 's2' }] })

    const parsed = Phase3GoalsFileSchema.safeParse(value)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.goals.map((g) => [g.id, g.name, 'memorySessionIds' in g])).toEqual([
      ['g1', 'Auth', false]
    ])
    expect(parsed.data?.tasks.map((t) => [t.id, t.title, 'touchedBy' in t])).toEqual([
      ['t1', 'Add login', false]
    ])
    expect(Object.keys(parsed.data ?? {}).sort()).toEqual(['goals', 'tasks', 'version'])
  })
})
