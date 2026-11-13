// Going back to the phase-1 build (R50): the settings and goals files memory phase 2 writes must
// still parse with the schemas that build reads them with. Both are plain `z.object` (not
// `.strict()`), so phase 1 keeps every file and drops the keys it does not know: on its load-time
// write the new settings fall back to their defaults and the tasks lose the six memory fields.
// The Past sessions file has its own test (`pastSessions.memory.test.ts`).
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createGoalsStore, type GoalsBlobStore } from './goals'
import { createSettingsStore } from './settings'
import {
  GoalSchema,
  TASK_DONE_BY,
  TaskStatusValueSchema,
  TaskTitleSchema,
  type GoalsFile
} from '../../shared/schemas/goal'
import { SettingsSchema, type Settings } from '../../shared/schemas/settings'
import { WorkspaceIdSchema } from '../../shared/schemas/workspace'

function blob<T>(): {
  blobStore: { read: () => unknown; write: (value: T) => void; backup: () => void }
  current: () => unknown
} {
  let value: unknown
  return {
    blobStore: {
      read: () => value,
      write: (next: T) => {
        value = next
      },
      backup: () => undefined
    },
    current: () => value
  }
}

// The phase-1 settings schema (`src/shared/schemas/settings.ts` at 120e59d, the commit before
// memory phase 2): `git diff 120e59d -- src/shared/schemas/settings.ts` only ADDS these three keys
// to `SettingsSchema`, so the current schema without them is that schema, field for field.
const Phase1SettingsSchema = SettingsSchema.omit({
  memoryCheckpoint: true,
  memorySaveTasks: true,
  memoryModel: true
})

// A FROZEN copy of the phase-1 task schema (`src/shared/schemas/goal.ts` at 120e59d). `GoalSchema`,
// `TaskTitleSchema`, `TaskStatusValueSchema` and `TASK_DONE_BY` are unchanged since. Never update
// it to follow the current schema: its point is that it does not.
const Phase1TaskSchema = z.object({
  id: z.string().min(1),
  workspaceId: WorkspaceIdSchema,
  goalId: z.string().nullable().default(null),
  title: TaskTitleSchema,
  status: TaskStatusValueSchema,
  sessionIds: z.array(z.string().min(1)).default([]),
  createdAt: z.number(),
  doneAt: z.number().nullable().default(null),
  doneBy: z.enum(TASK_DONE_BY).nullable().default(null)
})
const Phase1GoalsFileSchema = z.object({
  version: z.literal(1),
  goals: z.array(GoalSchema),
  tasks: z.array(Phase1TaskSchema)
})

describe('going back to the phase-1 build', () => {
  it('the phase-1 settings schema parses a settings file phase 2 wrote and drops its keys', () => {
    const file = blob<Settings>()
    const store = createSettingsStore({ blobStore: file.blobStore, log: () => undefined })
    store.set({ memoryCheckpoint: 25, memorySaveTasks: false, memoryModel: 'haiku' })
    const parsed = Phase1SettingsSchema.safeParse(file.current())
    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data ?? {})).not.toContain('memoryModel')
  })

  it('the phase-1 goals schema parses a goals file holding an extracted, reported task', () => {
    const file = blob<GoalsFile>()
    const store = createGoalsStore({
      blobStore: file.blobStore as GoalsBlobStore,
      newId: () => 't1',
      now: () => 5,
      log: () => undefined
    })
    store.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId: null,
      title: 'Add a health check',
      check: 'curl localhost:9281/health',
      leftWith: 'session',
      originSessionId: 's1',
      folder: '/work/api',
      at: 5
    })
    store.reportTask('t1', {
      at: 6,
      sessionId: 's1',
      sessionName: 'api',
      outcome: 'open',
      evidence: 'GET /health 404'
    })
    const parsed = Phase1GoalsFileSchema.safeParse(file.current())
    expect(parsed.success).toBe(true)
    expect(parsed.data?.tasks.map((t) => [t.id, 'check' in t])).toEqual([['t1', false]])
  })
})
