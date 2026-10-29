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
  // Stored by main from its own folder picker; the renderer never sends a path (spec §7). Required
  // for a new goal (create opens the picker first); null only on a goal made before that rule,
  // which cannot start sessions until it gets one (spec 2026-10-29).
  defaultCwd: z.string().min(1).nullable().default(null),
  // `Save to GOALS.md`: keep this goal and its tasks in `<defaultCwd>/GOALS.md` (goals/goalsFile.ts).
  saveToFile: z.boolean().default(false),
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

/** A task id that appears twice across a start's groups (or twice in one): one task, one session
 *  per start. Code only, never the id. */
export const TASK_REPEATED = 'task_repeated'

/** Flags every task id after its first appearance across `groups` (`TASK_REPEATED`). */
function refuseRepeatedTask(
  groups: readonly { taskIds: readonly string[] }[],
  ctx: z.RefinementCtx
): void {
  const seen = new Set<string>()
  groups.forEach((group, g) =>
    group.taskIds.forEach((id, t) => {
      if (seen.has(id))
        ctx.addIssue({ code: 'custom', message: TASK_REPEATED, path: [g, 'taskIds', t] })
      seen.add(id)
    })
  )
}

/** A proposal's groups: what a planner's `propose_split` sends (its arguments' one boundary) and
 *  what the view carries. The note shows in the sheet only; it never reaches a prompt. */
export const ProposalGroupsSchema = z
  .array(
    z
      .object({
        taskIds: z.array(IdSchema).min(1),
        note: z
          .string()
          .max(PROPOSAL_NOTE_MAX)
          .refine((v) => !hasControlChar(v), { error: 'must not contain control characters' })
      })
      .strict()
  )
  .min(1)
  .max(PROPOSAL_GROUPS_MAX)
  .superRefine(refuseRepeatedTask)

/** A planner's suggested split, in memory only (lives while the planner card lives). */
export const ProposalSchema = z.object({
  plannerSessionId: IdSchema,
  goalId: IdSchema,
  groups: ProposalGroupsSchema
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

/** Why a goal's `GOALS.md` did not follow its last change (goals/goalsFile.ts). Memory only. */
export const GOALS_FILE_PROBLEMS = [
  'goals_file_not_ours',
  'folder_missing',
  'goals_file_write_failed'
] as const
export type GoalsFileProblemCode = (typeof GOALS_FILE_PROBLEMS)[number]

export const GoalFileProblemSchema = z.object({
  goalId: IdSchema,
  code: z.enum(GOALS_FILE_PROBLEMS)
})
export type GoalFileProblem = z.infer<typeof GoalFileProblemSchema>

/** What main sends on `goals:changed` and answers every goals invoke with. */
export const GoalsViewSchema = z.object({
  goals: z.array(GoalSchema),
  tasks: z.array(TaskSchema),
  proposals: z.array(ProposalSchema),
  // One per goal with `saveToFile` whose folder's file did not follow; never on disk.
  fileProblems: z.array(GoalFileProblemSchema)
})
export type GoalsView = z.infer<typeof GoalsViewSchema>

// ---- Requests (renderer → main), all `.strict()` ----

export const GoalSaveSchema = z
  .object({ id: IdSchema.optional(), workspaceId: WorkspaceIdSchema, name: GoalNameSchema })
  .strict()
export type GoalSaveRequest = z.infer<typeof GoalSaveSchema>

export const GoalDeleteSchema = z.object({ id: IdSchema }).strict()
export type GoalDeleteRequest = z.infer<typeof GoalDeleteSchema>

/** `goals:pick-folder` — an id only; main opens the picker. */
export const GoalFolderSchema = z.object({ goalId: IdSchema }).strict()
export type GoalFolderRequest = z.infer<typeof GoalFolderSchema>

/** `goals:set-save-to-file` — an id and the switch; the folder is main's own record. */
export const GoalSaveToFileSchema = z.object({ goalId: IdSchema, on: z.boolean() }).strict()
export type GoalSaveToFileRequest = z.infer<typeof GoalSaveToFileSchema>

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
  .superRefine(refuseRepeatedTask)

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

/** The refusal `goals:save-goal` throws when the operator cancels the folder picker of a NEW goal:
 *  nothing is created, and the sheet says nothing. Shared: main throws it, the renderer matches it. */
export const FOLDER_CANCELLED = 'folder_cancelled'

/** The refusal for a goal with no folder (made before folders were required): a create without
 *  one, a start or a planner on it, or turning its `Save to GOALS.md` on. Shared like the above. */
export const GOAL_FOLDER_MISSING = 'goal_folder_missing'

/** The refusal `goals:plan` throws while the hook port is not this app's (SEC-6): the endpoint
 *  that serves the planner's tools lives on it, and a planner without its tools is useless. The
 *  API's 503 uses the same word. Shared: main throws it and the renderer matches it. */
export const HOOKS_UNAVAILABLE = 'hooks_unavailable'

export const GoalsPlanSchema = z.object({ goalId: IdSchema }).strict()
export type GoalsPlanRequest = z.infer<typeof GoalsPlanSchema>

/** An Accept always carries the rows the operator saw (main never fills them in from the
 *  proposal); a Reject carries nothing else. */
export const ProposalDecideSchema = z.discriminatedUnion('decision', [
  z
    .object({
      plannerSessionId: IdSchema,
      decision: z.literal('accept'),
      groups: StartGroupsSchema,
      markDone: z.boolean()
    })
    .strict(),
  z.object({ plannerSessionId: IdSchema, decision: z.literal('reject') }).strict()
])
export type ProposalDecideRequest = z.infer<typeof ProposalDecideSchema>
