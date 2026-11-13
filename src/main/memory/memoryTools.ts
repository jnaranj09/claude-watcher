// The seven memory tools a launched claude session calls over MCP (spec 2026-11-11 memory §3,
// phase 2 "Open work in Goals"): search (items, or the commands that worked), get, browse, save,
// update, mark stale, and `task_report`. The caller is an AI agent sending arbitrary input, so
// this file is a trust boundary: every argument set is one `.strict()` Zod `safeParse`
// (`invalid_params`), a session sees only its own workspace plus global items (and its own
// workspace's tasks and commands), and no tool can delete, pin or close a task (a name not listed
// here is `invalid_params`, like any unknown one). `task_report` only flags a task: the operator
// closes it. Only extraction writes an episode: save and update take a specific or a fact.
//
// The store's `get`, `edit` and `setState` take no scope, so this module checks it: an item
// outside the session's workspace (and not global) answers `memory_not_found`, exactly as an
// unknown id does. No tool input carries a workspace id, a session id, a basis or an origin;
// they are stamped here (a save is `inferred`, origin `agent` + the calling session).
//
// A refusal is a short code (`memory_not_found`, `store_write_failed`, `memory_read_failed`,
// `task_not_found`).
// Memory is off, the store missing or the session not live: `MEMORY_NOT_AVAILABLE`. Any other
// throw is a bug: it logs `code=memory_tool_failed` (never the error text, which can carry
// memory text) and answers `MEMORY_NOT_AVAILABLE`; the endpoint does not catch a tool's throw.
// Results carry memory text (that is their purpose); logs, errors and activity entries never do.
// Saved text cannot pass for a field of the result (`promptText.ts`): every one-line field (a
// key, a title, a source quote, a command, a session or tag name) is printed on one line, and a
// fact's or an episode's body comes last, after `body:`, each of its lines indented. Neither can
// pose as a system-reminder tag or the memory block marker (P3-C1).
import { z } from 'zod'
import { MemoryFiltersSchema, memoryFilterJsonSchema } from '../../shared/memory/filterFields'
import { TASK_REPORT_EVIDENCE_MAX, TaskReportSchema } from '../../shared/schemas/goal'
import {
  MEMORY_ERROR,
  MEMORY_ITEM_KINDS,
  MEMORY_KINDS,
  MEMORY_LIMITS,
  MemoryCreateSchema,
  MemoryGetSchema,
  MemoryListSchema,
  MemoryTextSchema,
  type MemoryItem
} from '../../shared/schemas/memory'
import { hasControlChar } from '../../shared/schemas/launch'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { McpToolDef, McpToolOutcome, McpTools } from '../mcp/mcpEndpoint'
import { GOAL_ERROR, type GoalsStore } from '../persistence/goals'
import { formatDay } from './formatDay'
import type { MemoryActivityLog } from './memoryActivity'
import type { MemoryCommands } from './memoryCommands'
import type { MemoryNames } from './memoryNames'
import { createMemoryGate, sessionItemMeta, type MemoryCall } from './memoryGate'
import type { FilterContext, MemoryStore } from './memoryStore'
import { indentedBlock, oneLine } from './promptText'

export type MemoryGrant = { sessionId: string }

export const MEMORY_MCP_SERVER_NAME = 'claude-watcher-memory'
export const MEMORY_TOOLS = [
  'memory_search',
  'memory_get',
  'memory_browse',
  'memory_save',
  'memory_update',
  'memory_mark_stale',
  'task_report'
] as const
type MemoryToolName = (typeof MEMORY_TOOLS)[number]

export const MEMORY_NOT_AVAILABLE = 'Memory is not available.'

export type MemorySessionMeta = {
  workspaceId: string
  folder: string
  sessionName: string
  tagIds: readonly string[]
  templateId: string | null
  goalId: string | null
  taskIds: readonly string[]
}

const LOG_PREFIX = '[claude-watcher][memory]'
const DEFAULT_LIMIT = 10
const NO_VALUE = '-'
const COMMAND_KIND = 'command'
/** A task id as the goals store makes it, with room to spare. */
const TASK_ID_MAX = 200
const UNKNOWN_TAG = 'unknown tag'
const BROWSE_BY = ['kind', 'folder', 'tag', 'month'] as const
/** Throws of the store that a tool answers as a code; any other throw is a bug. */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  MEMORY_ERROR.notFound,
  MEMORY_ERROR.readFailed,
  STORE_WRITE_FAILED
])

const ReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_LIMITS.reason)
  .refine((v) => !hasControlChar(v), { error: 'must not contain control characters' })
/** The list request's own `query` (trimmed, one line, no control character: SQLite never sees
 *  one, so a bad query is `invalid_params`, not a failed read). */
const QuerySchema = MemoryListSchema.shape.query.unwrap()
/** The create request's own `check` (trimmed, one line, null = none). */
const CheckSchema = MemoryCreateSchema.shape.check
const IdSchema = MemoryGetSchema.shape.id
const ScopeSchema = z.enum(['workspace', 'global'])

const LimitSchema = z.number().int().min(1).max(MEMORY_LIMITS.searchLimit)
const [SPECIFIC_TEXT, FACT_TEXT] = MemoryTextSchema.options
const ItemSearchArgsSchema = MemoryFiltersSchema.extend({
  query: QuerySchema.optional(),
  kind: z.enum(MEMORY_ITEM_KINDS).optional(),
  limit: LimitSchema.optional()
}).strict()
/** A command search takes only these: a filter it cannot apply is refused, never ignored. */
const CommandSearchArgsSchema = z
  .object({
    kind: z.literal(COMMAND_KIND),
    query: QuerySchema.optional(),
    folder: MemoryFiltersSchema.shape.folder,
    limit: LimitSchema.optional()
  })
  .strict()
const SearchArgsSchema = z.union([CommandSearchArgsSchema, ItemSearchArgsSchema])
const GetArgsSchema = z.object({ id: IdSchema, withSource: z.boolean().optional() }).strict()
const BrowseArgsSchema = z.object({ by: z.enum(BROWSE_BY) }).strict()
const SAVE_EXTRA = { check: CheckSchema.optional(), scope: ScopeSchema }
const UPDATE_EXTRA = { id: IdSchema, check: CheckSchema.optional(), reason: ReasonSchema }
// The text schemas are the store's own limits; a text is a kind's fields plus the extras.
const SaveArgsSchema = z.discriminatedUnion('kind', [
  SPECIFIC_TEXT.extend(SAVE_EXTRA),
  FACT_TEXT.extend(SAVE_EXTRA)
])
const UpdateArgsSchema = z.discriminatedUnion('kind', [
  SPECIFIC_TEXT.extend(UPDATE_EXTRA),
  FACT_TEXT.extend(UPDATE_EXTRA)
])
const MarkStaleArgsSchema = z.object({ id: IdSchema, reason: ReasonSchema }).strict()
const TaskReportArgsSchema = z
  .object({
    taskId: z.string().min(1).max(TASK_ID_MAX),
    outcome: TaskReportSchema.shape.outcome,
    evidence: TaskReportSchema.shape.evidence
  })
  .strict()

const TEXT_PROPERTIES = {
  kind: {
    type: 'string',
    enum: [...MEMORY_KINDS],
    description: 'specific: key + value. fact: title + body.'
  },
  key: {
    type: 'string',
    description: `specific only, one line, at most ${MEMORY_LIMITS.specificKey} characters.`
  },
  value: {
    type: 'string',
    description: `specific only, one line, at most ${MEMORY_LIMITS.specificValue} characters.`
  },
  title: {
    type: 'string',
    description: `fact only, one line, at most ${MEMORY_LIMITS.factTitle} characters.`
  },
  body: { type: 'string', description: `fact only, at most ${MEMORY_LIMITS.factBody} characters.` },
  check: {
    type: ['string', 'null'],
    description: `A command or step that shows whether it still holds, one line, at most ${MEMORY_LIMITS.check} characters. It is shown, never run.`
  }
}
const ID_PROPERTY = { type: 'string', description: 'The item id, as listed.' }
const REASON_PROPERTY = {
  type: 'string',
  description: `Why, one line, at most ${MEMORY_LIMITS.reason} characters.`
}

const DEFS: Record<MemoryToolName, McpToolDef> = {
  memory_search: {
    name: 'memory_search',
    description:
      "Search this workspace's memory (and global memory): short rows with id, kind, key or title, date, basis, session and tags. Filters narrow before the text query. Stale items are left out unless includeStale is true. Use memory_get for the full item. kind command lists the shell commands that worked in this workspace instead (id, command, folder, runs, last run), and takes only query, folder and limit.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `Words to find, at most ${MEMORY_LIMITS.query} characters.`
        },
        kind: { type: 'string', enum: [...MEMORY_ITEM_KINDS, COMMAND_KIND] },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MEMORY_LIMITS.searchLimit,
          description: `Rows to return (default ${DEFAULT_LIMIT}).`
        },
        ...memoryFilterJsonSchema()
      },
      additionalProperties: false
    }
  },
  memory_get: {
    name: 'memory_get',
    description:
      'Read one memory item by id: its text, check, basis, last-seen date, session, tags and state. withSource true adds the words of the session it was taken from, when it has them.',
    inputSchema: {
      type: 'object',
      properties: { id: ID_PROPERTY, withSource: { type: 'boolean' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  memory_browse: {
    name: 'memory_browse',
    description: 'Count active memory items by kind, folder, tag or month. Counts only.',
    inputSchema: {
      type: 'object',
      properties: { by: { type: 'string', enum: [...BROWSE_BY] } },
      required: ['by'],
      additionalProperties: false
    }
  },
  memory_save: {
    name: 'memory_save',
    description:
      'Save one thing worth remembering across sessions. A specific is a key + value (a path, a port, a command); a fact is a title + body. scope "workspace" keeps it for this workspace, "global" for every workspace. Returns the new id.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TEXT_PROPERTIES,
        scope: { type: 'string', enum: ['workspace', 'global'] }
      },
      required: ['kind', 'scope'],
      additionalProperties: false
    }
  },
  memory_update: {
    name: 'memory_update',
    description:
      "Replace the text of one memory item with a new version (the old one is kept). Give the texts of the same kind as the item. Omit check to keep the item's check; null clears it.",
    inputSchema: {
      type: 'object',
      properties: { id: ID_PROPERTY, ...TEXT_PROPERTIES, reason: REASON_PROPERTY },
      required: ['id', 'kind', 'reason'],
      additionalProperties: false
    }
  },
  memory_mark_stale: {
    name: 'memory_mark_stale',
    description:
      'Mark one memory item stale because it no longer holds. It stops showing in searches.',
    inputSchema: {
      type: 'object',
      properties: { id: ID_PROPERTY, reason: REASON_PROPERTY },
      required: ['id', 'reason'],
      additionalProperties: false
    }
  },
  task_report: {
    name: 'task_report',
    description:
      'Report what you saw when you checked an open task of this workspace (from the memory index). done flags it as reported done; the operator closes it. open records that it is still open today.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task id, as listed (id=…).' },
        outcome: { type: 'string', enum: ['done', 'open'] },
        evidence: {
          type: 'string',
          description: `What you saw, one line, at most ${TASK_REPORT_EVIDENCE_MAX} characters.`
        }
      },
      required: ['taskId', 'outcome', 'evidence'],
      additionalProperties: false
    }
  }
}

const refused = (code: string): McpToolOutcome => ({ kind: 'result', text: code, isError: true })
const ok = (text: string): McpToolOutcome => ({ kind: 'result', text, isError: false })
/** The model reads the sentence; the endpoint logs the code. */
const notAvailable = (): McpToolOutcome => ({
  kind: 'result',
  text: MEMORY_NOT_AVAILABLE,
  isError: true,
  code: 'memory_not_available'
})

/** What one call works with once the gate passed (`memoryGate.ts`). */
interface Call extends MemoryCall {
  filterContext: FilterContext
  record(
    action: 'pulled' | 'saved' | 'updated' | 'marked_stale',
    tool: string,
    itemId: string | null
  ): void
  tagNames(ids: readonly string[]): string
  /** The item when it exists and is in the session's scope; else `memory_not_found`. */
  visible(id: string): MemoryItem
}

/** The head lines of `memory_get` (an episode adds the day its session ended), and the body
 *  block that ends the result: a fact or episode body keeps its lines, each indented, after every
 *  field, so no line of it can pass for one of the item's fields. */
function itemText(item: MemoryItem): { head: string[]; body: string[] } {
  switch (item.kind) {
    case 'specific':
      return { head: [`key: ${oneLine(item.key)}`, `value: ${oneLine(item.value)}`], body: [] }
    case 'fact':
      return {
        head: [`title: ${oneLine(item.title)}`],
        body: ['body:', ...indentedBlock(item.body)]
      }
    case 'episode':
      return {
        head: [`title: ${oneLine(item.title)}`, `ended: ${formatDay(item.endedAt)}`],
        body: ['body:', ...indentedBlock(item.body)]
      }
  }
}

function isMemoryToolName(name: string): name is MemoryToolName {
  return MEMORY_TOOLS.some((t) => t === name)
}

export function createMemoryTools(deps: {
  enabled: () => boolean
  store: () => MemoryStore | null
  /** null = not a live session. */
  session: (sessionId: string) => MemorySessionMeta | null
  names: MemoryNames
  /** The goals store `task_report` reads and writes; null = not available. */
  tasks: () => Pick<GoalsStore, 'view' | 'reportTask'> | null
  /** The commands a `command` search lists; null = not available. */
  commands: () => Pick<MemoryCommands, 'list'> | null
  activity: Pick<MemoryActivityLog, 'record'>
  now: () => number
  log: (line: string) => void
}): McpTools<MemoryGrant> {
  const { names } = deps

  function tagNames(ids: readonly string[]): string {
    const named = ids.flatMap((id) => {
      const name = names.tagName(id)
      return name === null ? [] : [oneLine(name)]
    })
    return named.length === 0 ? NO_VALUE : named.join(', ')
  }

  /** `folder: "here"` is the calling session's folder; a session with none matches nothing. */
  function searchCommands(args: z.infer<typeof CommandSearchArgsSchema>, c: Call): McpToolOutcome {
    const commands = deps.commands()
    if (commands === null) return notAvailable()
    const folder = args.folder === 'here' ? c.session.folder : (args.folder ?? null)
    const { rows, total } =
      folder === ''
        ? { rows: [], total: 0 }
        : commands.list(c.session.workspaceId, {
            query: args.query ?? null,
            folder,
            offset: 0,
            limit: args.limit ?? DEFAULT_LIMIT
          })
    c.record('pulled', 'memory_search', null)
    if (rows.length === 0) return ok('No items.')
    const lines = rows.map((r) =>
      [r.id, oneLine(r.text), oneLine(r.folder), String(r.count), formatDay(r.lastAt)]
        .concat(
          r.sessionDeletedAt === null ? [] : [`session deleted ${formatDay(r.sessionDeletedAt)}`]
        )
        .join(' | ')
    )
    return ok(
      ['id | command | folder | runs | last run', ...lines, `${rows.length} of ${total}`].join('\n')
    )
  }

  function search(args: unknown, c: Call): McpToolOutcome {
    const parsed = SearchArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    if (parsed.data.kind === COMMAND_KIND) return searchCommands(parsed.data, c)
    const { query, kind, limit, ...filters } = parsed.data
    const { rows, total } = c.store.search(
      c.scope,
      {
        kind: kind ?? null,
        query: query ?? null,
        filters,
        offset: 0,
        limit: limit ?? DEFAULT_LIMIT
      },
      c.filterContext
    )
    c.record('pulled', 'memory_search', null)
    if (rows.length === 0) return ok('No items.')
    const lines = rows.map((r) =>
      [
        r.id,
        r.kind,
        oneLine(r.head),
        formatDay(r.updatedAt),
        r.basis,
        r.sessionName === null ? NO_VALUE : oneLine(r.sessionName),
        c.tagNames(r.tagIds)
      ]
        .concat(r.state === 'stale' ? ['stale'] : [])
        .concat(
          r.originDeletedAt === null ? [] : [`session deleted ${formatDay(r.originDeletedAt)}`]
        )
        .join(' | ')
    )
    return ok(
      [
        'id | kind | key/title | date | basis | session | tags',
        ...lines,
        `${rows.length} of ${total}`
      ].join('\n')
    )
  }

  function get(args: unknown, c: Call): McpToolOutcome {
    const parsed = GetArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const item = c.visible(parsed.data.id)
    c.record('pulled', 'memory_get', item.id)
    const source =
      parsed.data.withSource === true && item.source !== null
        ? [`source: ${oneLine(item.source.quote)}`]
        : []
    const { head, body } = itemText(item)
    return ok(
      [
        ...head,
        `basis: ${item.basis}`,
        ...source,
        `seen: ${formatDay(item.lastSeenAt)}`,
        ...(item.check === null ? [] : [`check: ${oneLine(item.check)}`]),
        `session: ${item.meta.sessionName === null ? NO_VALUE : oneLine(item.meta.sessionName)}`,
        `tags: ${c.tagNames(item.meta.tagIds)}`,
        `state: ${item.state}`,
        ...(item.originDeletedAt === null
          ? []
          : [`session deleted: ${formatDay(item.originDeletedAt)}`]),
        ...body
      ].join('\n')
    )
  }

  /** A session's own report on a task of its workspace: stamped here, never from the input. A done
   *  task answers `Reported.` and stays as it is (the store's rule); nothing here closes one. */
  function taskReport(args: unknown, c: Call): McpToolOutcome {
    const parsed = TaskReportArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const goals = deps.tasks()
    if (goals === null) return notAvailable()
    const { taskId, outcome, evidence } = parsed.data
    const task = goals.view().tasks.find((t) => t.id === taskId)
    if (task === undefined || task.workspaceId !== c.session.workspaceId) {
      return refused(GOAL_ERROR.taskNotFound)
    }
    const answer = goals.reportTask(task.id, {
      at: deps.now(),
      sessionId: c.sessionId,
      sessionName: c.session.sessionName,
      outcome,
      evidence
    })
    if (answer === 'not_found') return refused(GOAL_ERROR.taskNotFound)
    c.record('updated', 'task_report', null)
    return ok('Reported.')
  }

  function browse(args: unknown, c: Call): McpToolOutcome {
    const parsed = BrowseArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const { by } = parsed.data
    const buckets = c.store.browse(c.scope, by)
    if (buckets.length === 0) return ok('No items.')
    return ok(
      buckets
        .map(
          (b) =>
            `${oneLine(by === 'tag' ? (names.tagName(b.key) ?? UNKNOWN_TAG) : b.key)}: ${b.count}`
        )
        .join('\n')
    )
  }

  function save(args: unknown, c: Call): McpToolOutcome {
    const parsed = SaveArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const { check, scope, ...text } = parsed.data
    const item = c.store.add({
      text,
      workspaceId: scope === 'global' ? null : c.session.workspaceId,
      check: check ?? null,
      basis: 'inferred',
      origin: { by: 'agent', sessionId: c.sessionId },
      meta: sessionItemMeta(c.session),
      source: null
    })
    c.record('saved', 'memory_save', item.id)
    return ok(`Saved. id=${item.id}`)
  }

  function update(args: unknown, c: Call): McpToolOutcome {
    const parsed = UpdateArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const { id, check, reason, ...text } = parsed.data
    const current = c.visible(id)
    // The store refuses a text of the other kind with `memory_not_found`.
    const item = c.store.edit(
      id,
      { text, check: check === undefined ? current.check : check },
      'agent',
      reason
    )
    c.record('updated', 'memory_update', item.id)
    return ok('Updated.')
  }

  function markStale(args: unknown, c: Call): McpToolOutcome {
    const parsed = MarkStaleArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const item = c.visible(parsed.data.id)
    c.store.setState(item.id, 'stale', 'agent', parsed.data.reason)
    c.record('marked_stale', 'memory_mark_stale', item.id)
    return ok('Marked stale.')
  }

  const RUN: Record<MemoryToolName, (args: unknown, c: Call) => McpToolOutcome> = {
    memory_search: search,
    memory_get: get,
    memory_browse: browse,
    memory_save: save,
    memory_update: update,
    memory_mark_stale: markStale,
    task_report: taskReport
  }

  const gate = createMemoryGate(deps)

  function open(grant: MemoryGrant): Call | null {
    const gated = gate(grant)
    if (gated === null) return null
    const { store, session } = gated
    const { workspaceId } = session
    return {
      ...gated,
      filterContext: {
        sessionFolder: session.folder,
        tagIdsByName: (n) => names.tagIdsByName(workspaceId, n),
        goalIdsByName: (n) => names.goalIdsByName(workspaceId, n)
      },
      record: (action, tool, itemId) =>
        deps.activity.record(grant.sessionId, {
          at: deps.now(),
          action,
          tool,
          itemId,
          reason: null
        }),
      tagNames,
      visible: (id) => {
        const item = store.get(id)
        if (item === null || (item.workspaceId !== workspaceId && item.workspaceId !== null)) {
          throw new Error(MEMORY_ERROR.notFound)
        }
        return item
      }
    }
  }

  return {
    list: () => MEMORY_TOOLS.map((t) => DEFS[t]),
    call(name, args, grant) {
      if (!isMemoryToolName(name)) return { kind: 'invalid_params' }
      try {
        const call = open(grant)
        if (call === null) return notAvailable()
        return RUN[name](args, call)
      } catch (e) {
        if (e instanceof Error && KNOWN_CODES.has(e.message)) return refused(e.message)
        deps.log(`${LOG_PREFIX} code=memory_tool_failed`)
        return notAvailable()
      }
    }
  }
}
