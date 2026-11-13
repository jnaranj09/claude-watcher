// The six memory tools a launched claude session calls over MCP (spec 2026-11-11 memory §3):
// search, get, browse, save, update, mark stale. The caller is an AI agent sending arbitrary
// input, so this file is a trust boundary: every argument set is one `.strict()` Zod `safeParse`
// (`invalid_params`), a session sees only its own workspace plus global items, and no tool can
// delete or pin (a name not listed here is `invalid_params`, like any unknown one).
//
// The store's `get`, `edit` and `setState` take no scope, so this module checks it: an item
// outside the session's workspace (and not global) answers `memory_not_found`, exactly as an
// unknown id does. No tool input carries a workspace id, a session id, a basis or an origin;
// they are stamped here (a save is `inferred`, origin `agent` + the calling session).
//
// A refusal is a short code (`memory_not_found`, `store_write_failed`, `memory_read_failed`).
// Memory is off, the store missing or the session not live: `MEMORY_NOT_AVAILABLE`. Any other
// throw is a bug: it logs `code=memory_tool_failed` (never the error text, which can carry
// memory text) and answers `MEMORY_NOT_AVAILABLE`; the endpoint does not catch a tool's throw.
// Results carry memory text (that is their purpose); logs, errors and activity entries never do.
import { z } from 'zod'
import { MemoryFiltersSchema, memoryFilterJsonSchema } from '../../shared/memory/filterFields'
import {
  MEMORY_ERROR,
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
import { formatDay } from './formatDay'
import type { MemoryActivityLog } from './memoryActivity'
import type { MemoryNames } from './memoryNames'
import type { FilterContext, MemoryScope, MemoryStore } from './memoryStore'

export type MemoryGrant = { sessionId: string }

export const MEMORY_MCP_SERVER_NAME = 'claude-watcher-memory'
export const MEMORY_TOOLS = [
  'memory_search',
  'memory_get',
  'memory_browse',
  'memory_save',
  'memory_update',
  'memory_mark_stale'
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

const [SPECIFIC_TEXT, FACT_TEXT] = MemoryTextSchema.options
const SearchArgsSchema = MemoryFiltersSchema.extend({
  query: QuerySchema.optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  limit: z.number().int().min(1).max(MEMORY_LIMITS.searchLimit).optional()
}).strict()
const GetArgsSchema = z.object({ id: IdSchema }).strict()
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
      "Search this workspace's memory (and global memory): short rows with id, kind, key or title, date, basis, session and tags. Filters narrow before the text query. Stale items are left out unless includeStale is true. Use memory_get for the full item.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `Words to find, at most ${MEMORY_LIMITS.query} characters.`
        },
        kind: { type: 'string', enum: [...MEMORY_KINDS] },
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
      'Read one memory item by id: its text, check, basis, last-seen date, session, tags and state.',
    inputSchema: {
      type: 'object',
      properties: { id: ID_PROPERTY },
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

/** What one call works with once the gates passed. */
interface Call {
  store: MemoryStore
  sessionId: string
  session: MemorySessionMeta
  scope: MemoryScope
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

function isMemoryToolName(name: string): name is MemoryToolName {
  return MEMORY_TOOLS.some((t) => t === name)
}

export function createMemoryTools(deps: {
  enabled: () => boolean
  store: () => MemoryStore | null
  /** null = not a live session. */
  session: (sessionId: string) => MemorySessionMeta | null
  names: MemoryNames
  activity: Pick<MemoryActivityLog, 'record'>
  now: () => number
  log: (line: string) => void
}): McpTools<MemoryGrant> {
  const { names } = deps

  function tagNames(ids: readonly string[]): string {
    const named = ids.flatMap((id) => names.tagName(id) ?? [])
    return named.length === 0 ? NO_VALUE : named.join(', ')
  }

  function search(args: unknown, c: Call): McpToolOutcome {
    const parsed = SearchArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
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
        r.head,
        formatDay(r.updatedAt),
        r.basis,
        r.sessionName ?? NO_VALUE,
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
    const text =
      item.kind === 'specific'
        ? [`key: ${item.key}`, `value: ${item.value}`]
        : [`title: ${item.title}`, `body: ${item.body}`]
    return ok(
      [
        ...text,
        `basis: ${item.basis}`,
        `seen: ${formatDay(item.lastSeenAt)}`,
        ...(item.check === null ? [] : [`check: ${item.check}`]),
        `session: ${item.meta.sessionName ?? NO_VALUE}`,
        `tags: ${c.tagNames(item.meta.tagIds)}`,
        `state: ${item.state}`,
        ...(item.originDeletedAt === null
          ? []
          : [`session deleted: ${formatDay(item.originDeletedAt)}`])
      ].join('\n')
    )
  }

  function browse(args: unknown, c: Call): McpToolOutcome {
    const parsed = BrowseArgsSchema.safeParse(args)
    if (!parsed.success) return { kind: 'invalid_params' }
    const { by } = parsed.data
    const buckets = c.store.browse(c.scope, by)
    if (buckets.length === 0) return ok('No items.')
    return ok(
      buckets
        .map((b) => `${by === 'tag' ? (names.tagName(b.key) ?? UNKNOWN_TAG) : b.key}: ${b.count}`)
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
      meta: {
        folder: c.session.folder === '' ? null : c.session.folder,
        sessionName: c.session.sessionName === '' ? null : c.session.sessionName,
        tagIds: [...c.session.tagIds],
        templateId: c.session.templateId,
        goalId: c.session.goalId,
        taskIds: [...c.session.taskIds]
      },
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
    memory_mark_stale: markStale
  }

  function open(grant: MemoryGrant): Call | null {
    if (!deps.enabled()) return null
    const store = deps.store()
    const session = deps.session(grant.sessionId)
    if (store === null || session === null) return null
    const { workspaceId } = session
    return {
      store,
      sessionId: grant.sessionId,
      session,
      scope: { workspaceId, includeGlobal: true },
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
