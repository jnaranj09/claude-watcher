// The tools the goals MCP endpoint serves, by grant mode (spec 2026-10-19 goals, Claude
// integration). A worker session started from tasks with "Claude can mark tasks done" on gets one
// tool, `mark_task_done`. A planner gets three: `list_tasks`, `create_task`, `propose_split`, all
// bound to the goal it was launched on (the grant's `goalId`; no tool takes a goal id). A planner
// never gets `mark_task_done`, and a worker never gets a planner tool: a name the grant does not
// hold is `invalid_params`, like an unknown one.
//
// Authority for `mark_task_done` is the task's CURRENT links: it changes a task only when its
// `sessionIds` holds the calling session and it sits in the grant's workspace. Unlinking revokes
// it. A planner's goal must still exist in the grant's workspace (`goal_not_found`); `create_task`
// goes through `TaskSaveSchema`, the same title rules as the sheet (`title_invalid`); and
// `propose_split` names only that goal's OPEN tasks (`task_not_in_goal`), each once
// (`task_repeated`), or nothing is stored. Planner-written titles reach later sessions' prompts;
// the operator sees every task in the sheet and accepts the split first.
//
// A refusal is a short code and never echoes a title or an id. Every argument passes a strict Zod
// schema first (fail closed: `invalid_params`). Only `list_tasks`' result carries titles, and only
// to the session: results are never logged (`mcp/mcpEndpoint.ts` logs the code).
import { z } from 'zod'
import {
  ProposalGroupsSchema,
  TASK_REPEATED,
  TaskSaveSchema,
  type Goal
} from '../../../shared/schemas/goal'
import type { GoalsStore } from '../../persistence/goals'
import type { Proposals } from '../proposals'
import type { Grant } from './goalTokens'
import type { McpToolDef, McpToolOutcome, McpTools } from '../../mcp/mcpEndpoint'

export const MARK_TASK_DONE = 'mark_task_done'
export const LIST_TASKS = 'list_tasks'
export const CREATE_TASK = 'create_task'
export const PROPOSE_SPLIT = 'propose_split'
/** The planner's tools, in the order `tools/list` gives them. */
export const PLANNER_TOOLS = [LIST_TASKS, CREATE_TASK, PROPOSE_SPLIT] as const
/** Task ids are main's own short ids; anything longer is not one. */
const TASK_ID_MAX = 200

const MarkTaskDoneArgsSchema = z.object({ taskId: z.string().min(1).max(TASK_ID_MAX) }).strict()
const ListTasksArgsSchema = z.object({}).strict()
/** The shape only; the title's rules are `TaskSaveSchema`'s (one boundary for every title). */
const CreateTaskArgsSchema = z.object({ title: z.string() }).strict()
const ProposeSplitArgsSchema = z.object({ groups: z.unknown() }).strict()

const MARK_TASK_DONE_DEF: McpToolDef = {
  name: MARK_TASK_DONE,
  description:
    "Mark one of this session's tasks done, by the id shown in its task list. Call it when the task is finished.",
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string', description: 'The task id, as listed.' } },
    required: ['taskId'],
    additionalProperties: false
  }
}

const LIST_TASKS_DEF: McpToolDef = {
  name: LIST_TASKS,
  description:
    "List the tasks of the goal this session plans: each task's id, title and status (open or done).",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}

const CREATE_TASK_DEF: McpToolDef = {
  name: CREATE_TASK,
  description:
    'Add one task to the goal this session plans. The title is one line, at most 200 characters. Returns the new task id.',
  inputSchema: {
    type: 'object',
    properties: { title: { type: 'string', description: 'The task title, one line.' } },
    required: ['title'],
    additionalProperties: false
  }
}

const PROPOSE_SPLIT_DEF: McpToolDef = {
  name: PROPOSE_SPLIT,
  description:
    'Propose how to split the open tasks of this goal into sessions: one group per session, each with its task ids and a short note. The operator accepts, edits or rejects it; nothing starts before that. A new proposal replaces the last one.',
  inputSchema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            taskIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
            note: { type: 'string', description: 'Why these tasks go together, one line.' }
          },
          required: ['taskIds', 'note'],
          additionalProperties: false
        }
      }
    },
    required: ['groups'],
    additionalProperties: false
  }
}

const refused = (code: string): McpToolOutcome => ({ kind: 'result', text: code, isError: true })

const ok = (text: string): McpToolOutcome => ({ kind: 'result', text, isError: false })

type ToolsStore = Pick<GoalsStore, 'view' | 'setTaskStatus' | 'addTaskFromSession'>
type PlannerGrant = Extract<Grant, { mode: 'planner' }>

/** `store` is read per call: the goals store exists only after app-ready. */
export function createMcpTools(
  store: () => ToolsStore,
  proposals: Pick<Proposals, 'set'>
): McpTools<Grant> {
  function markTaskDone(args: unknown, grant: Grant): McpToolOutcome {
    const parsed = MarkTaskDoneArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const goals = store()
    const task = goals.view().tasks.find((t) => t.id === parsed.data.taskId)
    if (task === undefined) return refused('task_not_found')
    if (task.workspaceId !== grant.workspaceId || !task.sessionIds.includes(grant.sessionId)) {
      return refused('task_not_linked')
    }
    // Already done: succeeds and changes nothing (spec, Assumed). By 'session', the store keeps
    // the change and reports the disk; it never throws for a disk failure.
    if (task.status !== 'done') goals.setTaskStatus(task.id, 'done', 'session')
    return ok('done')
  }

  /** The planner's goal, only while it still exists in the grant's workspace. */
  function goalOf(grant: PlannerGrant): Goal | null {
    const goal = store()
      .view()
      .goals.find((g) => g.id === grant.goalId)
    return goal !== undefined && goal.workspaceId === grant.workspaceId ? goal : null
  }

  function listTasks(args: unknown, grant: PlannerGrant): McpToolOutcome {
    if (!ListTasksArgsSchema.safeParse(args ?? {}).success) return { kind: 'invalid_params' }
    const goal = goalOf(grant)
    if (goal === null) return refused('goal_not_found')
    const tasks = store()
      .view()
      .tasks.filter((t) => t.goalId === goal.id && t.workspaceId === goal.workspaceId)
      .map((t) => ({ id: t.id, title: t.title, status: t.status }))
    return ok(JSON.stringify(tasks))
  }

  function createTask(args: unknown, grant: PlannerGrant): McpToolOutcome {
    const shape = CreateTaskArgsSchema.safeParse(args)
    if (!shape.success) return { kind: 'invalid_params' }
    const goal = goalOf(grant)
    if (goal === null) return refused('goal_not_found')
    // The sheet's own request schema: trim, 1..200, no control characters.
    const req = TaskSaveSchema.safeParse({
      workspaceId: goal.workspaceId,
      goalId: goal.id,
      title: shape.data.title
    })
    if (!req.success) return refused('title_invalid')
    // A disk refusal is reported to storage health and the task holds for this run.
    const saved = store().addTaskFromSession(req.data)
    return ok(JSON.stringify({ id: saved.id }))
  }

  function proposeSplit(args: unknown, grant: PlannerGrant): McpToolOutcome {
    const shape = ProposeSplitArgsSchema.safeParse(args)
    if (!shape.success) return { kind: 'invalid_params' }
    const parsed = ProposalGroupsSchema.safeParse(shape.data.groups)
    if (!parsed.success) {
      // Only a well-formed split whose one fault is a repeated id gets the code back.
      const repeated = parsed.error.issues.every((i) => i.message === TASK_REPEATED)
      return repeated ? refused(TASK_REPEATED) : { kind: 'invalid_params' }
    }
    const goal = goalOf(grant)
    if (goal === null) return refused('goal_not_found')
    const open = new Set(
      store()
        .view()
        .tasks.filter(
          (t) => t.goalId === goal.id && t.workspaceId === goal.workspaceId && t.status === 'open'
        )
        .map((t) => t.id)
    )
    if (parsed.data.some((group) => group.taskIds.some((id) => !open.has(id)))) {
      return refused('task_not_in_goal')
    }
    proposals.set({ plannerSessionId: grant.sessionId, goalId: goal.id, groups: parsed.data })
    return ok('proposed')
  }

  return {
    list(grant) {
      return grant.mode === 'worker'
        ? [MARK_TASK_DONE_DEF]
        : [LIST_TASKS_DEF, CREATE_TASK_DEF, PROPOSE_SPLIT_DEF]
    },
    call(name, args, grant) {
      if (grant.mode === 'worker') {
        return name === MARK_TASK_DONE ? markTaskDone(args, grant) : { kind: 'invalid_params' }
      }
      switch (name) {
        case LIST_TASKS:
          return listTasks(args, grant)
        case CREATE_TASK:
          return createTask(args, grant)
        case PROPOSE_SPLIT:
          return proposeSplit(args, grant)
        default:
          return { kind: 'invalid_params' }
      }
    }
  }
}
