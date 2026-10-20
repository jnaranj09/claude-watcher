// Goals — a workspace's goals and tasks, and their IPC/file boundaries (spec 2026-10-19 goals).
// OUR shape: fail-closed, requests `.strict()`. NEVER log a goal name or a task title (operator
// text, and a planner session writes some of them) — issue path + code only.
import { z } from 'zod'
import { hasControlChar } from './launch'
import { WorkspaceIdSchema } from './workspace'

export const GOAL_NAME_MAX = 80
export const TASK_TITLE_MAX = 200
export const PROPOSAL_GROUPS_MAX = 10
export const PROPOSAL_NOTE_MAX = 200

/** Not `.uuid()` — existence is the store's call (`goal_not_found`, `task_not_found`). */
const IdSchema = z.string().min(1)

function singleLine(max: number): z.ZodString {
  return z.string().trim().min(1).max(max)
}

export const GoalNameSchema = singleLine(GOAL_NAME_MAX).refine((v) => !hasControlChar(v), {
  error: 'must not contain control characters'
})
export const TaskTitleSchema = singleLine(TASK_TITLE_MAX).refine((v) => !hasControlChar(v), {
  error: 'must not contain control characters'
})

export const TASK_STATUSES = ['open', 'done'] as const
export const TaskStatusValueSchema = z.enum(TASK_STATUSES)
export type TaskStatus = z.infer<typeof TaskStatusValueSchema>

export const TASK_DONE_BY = ['operator', 'session'] as const
export type TaskDoneBy = (typeof TASK_DONE_BY)[number]

export const GoalSchema = z.object({
  id: IdSchema,
  workspaceId: WorkspaceIdSchema,
  name: GoalNameSchema,
  // Stored by main from its own folder picker; the renderer never sends a path (spec §7).
  defaultCwd: z.string().min(1).nullable().default(null),
  createdAt: z.number()
})
export type Goal = z.infer<typeof GoalSchema>

export const TaskSchema = z.object({
  id: IdSchema,
  workspaceId: WorkspaceIdSchema,
  // null = a loose task.
  goalId: z.string().nullable().default(null),
  title: TaskTitleSchema,
  status: TaskStatusValueSchema,
  // The minted `--session-id` values of the cards this task is linked to.
  sessionIds: z.array(z.string().min(1)).default([]),
  createdAt: z.number(),
  doneAt: z.number().nullable().default(null),
  doneBy: z.enum(TASK_DONE_BY).nullable().default(null)
})
export type Task = z.infer<typeof TaskSchema>

/** A planner's suggested split, in memory only (lives while the planner card lives). */
export const ProposalSchema = z.object({
  plannerSessionId: IdSchema,
  goalId: IdSchema,
  groups: z
    .array(
      z.object({
        taskIds: z.array(IdSchema).min(1),
        note: z.string().max(PROPOSAL_NOTE_MAX)
      })
    )
    .min(1)
    .max(PROPOSAL_GROUPS_MAX)
})
export type Proposal = z.infer<typeof ProposalSchema>

export const GOALS_FILE_VERSION = 1 as const
export const GoalsFileSchema = z.object({
  version: z.literal(GOALS_FILE_VERSION),
  goals: z.array(GoalSchema),
  tasks: z.array(TaskSchema)
})
export type GoalsFile = z.infer<typeof GoalsFileSchema>

export const EMPTY_GOALS_FILE: GoalsFile = { version: GOALS_FILE_VERSION, goals: [], tasks: [] }

/** What main sends on `goals:changed` and answers every goals invoke with. */
export const GoalsViewSchema = z.object({
  goals: z.array(GoalSchema),
  tasks: z.array(TaskSchema),
  proposals: z.array(ProposalSchema)
})
export type GoalsView = z.infer<typeof GoalsViewSchema>

// ---- Requests (renderer → main), all `.strict()` ----

export const GoalSaveSchema = z
  .object({ id: IdSchema.optional(), workspaceId: WorkspaceIdSchema, name: GoalNameSchema })
  .strict()
export type GoalSaveRequest = z.infer<typeof GoalSaveSchema>

export const GoalDeleteSchema = z.object({ id: IdSchema }).strict()
export type GoalDeleteRequest = z.infer<typeof GoalDeleteSchema>

/** `goals:pick-folder` / `goals:clear-folder` — an id only; main opens the picker. */
export const GoalFolderSchema = z.object({ goalId: IdSchema }).strict()
export type GoalFolderRequest = z.infer<typeof GoalFolderSchema>

export const TaskSaveSchema = z
  .object({
    id: IdSchema.optional(),
    workspaceId: WorkspaceIdSchema,
    goalId: IdSchema.nullable(),
    title: TaskTitleSchema
  })
  .strict()
export type TaskSaveRequest = z.infer<typeof TaskSaveSchema>

export const TaskDeleteSchema = z.object({ id: IdSchema }).strict()
export type TaskDeleteRequest = z.infer<typeof TaskDeleteSchema>

export const TaskStatusSchema = z.object({ id: IdSchema, status: TaskStatusValueSchema }).strict()
export type TaskStatusRequest = z.infer<typeof TaskStatusSchema>

export const TaskLinkSchema = z.object({ taskId: IdSchema, sessionId: IdSchema }).strict()
export type TaskLinkRequest = z.infer<typeof TaskLinkSchema>

const StartGroupsSchema = z
  .array(z.object({ taskIds: z.array(IdSchema).min(1) }).strict())
  .min(1)
  .max(PROPOSAL_GROUPS_MAX)

export const GoalsStartSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    goalId: IdSchema.nullable(),
    groups: StartGroupsSchema,
    markDone: z.boolean()
  })
  .strict()
export type GoalsStartRequest = z.infer<typeof GoalsStartSchema>

/** The refusal `goals:start-sessions` throws when the operator cancels the folder picker. Nothing
 *  launched, so the sheet says nothing (the `+ New session` cancel precedent). Shared: main throws
 *  it and the renderer matches it. */
export const LAUNCH_CANCELLED = 'launch_cancelled'

export const GoalsPlanSchema = z.object({ goalId: IdSchema }).strict()
export type GoalsPlanRequest = z.infer<typeof GoalsPlanSchema>

export const ProposalDecideSchema = z
  .object({
    plannerSessionId: IdSchema,
    decision: z.enum(['accept', 'reject']),
    groups: StartGroupsSchema.optional(),
    markDone: z.boolean()
  })
  .strict()
export type ProposalDecideRequest = z.infer<typeof ProposalDecideSchema>
