// The tools the goals MCP endpoint serves, by grant mode (spec 2026-10-19 goals, Claude
// integration). A worker session started from tasks with "Claude can mark tasks done" on gets one
// tool, `mark_task_done`; a planner gets none yet.
//
// Authority is the task's CURRENT links: `mark_task_done` changes a task only when its `sessionIds`
// holds the calling session and it sits in the grant's workspace. Unlinking revokes it. A refusal
// is a short code (`task_not_found`, `task_not_linked`) and never echoes a title. Every argument
// passes a strict Zod schema first (fail closed: `invalid_params`).
import { z } from 'zod'
import type { GoalsStore } from '../../persistence/goals'
import type { Grant } from './goalTokens'

export const MARK_TASK_DONE = 'mark_task_done'
/** Task ids are main's own short ids; anything longer is not one. */
const TASK_ID_MAX = 200

const MarkTaskDoneArgsSchema = z.object({ taskId: z.string().min(1).max(TASK_ID_MAX) }).strict()

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpToolOutcome =
  | { kind: 'result'; text: string; isError: boolean }
  /** An unknown tool for this grant, or arguments that fail the schema. */
  | { kind: 'invalid_params' }

export interface McpTools {
  list(grant: Grant): readonly McpToolDef[]
  call(name: string, args: unknown, grant: Grant): McpToolOutcome
}

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

const refused = (code: string): McpToolOutcome => ({ kind: 'result', text: code, isError: true })

/** `store` is read per call: the goals store exists only after app-ready. */
export function createMcpTools(store: () => Pick<GoalsStore, 'view' | 'setTaskStatus'>): McpTools {
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
    return { kind: 'result', text: 'done', isError: false }
  }

  return {
    list(grant) {
      return grant.mode === 'worker' ? [MARK_TASK_DONE_DEF] : []
    },
    call(name, args, grant) {
      if (grant.mode === 'worker' && name === MARK_TASK_DONE) return markTaskDone(args, grant)
      return { kind: 'invalid_params' }
    }
  }
}
