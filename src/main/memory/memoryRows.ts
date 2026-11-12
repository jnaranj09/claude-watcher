// How a memory item comes out of SQLite (spec 2026-11-11 memory §2): the columns, the join to its
// current text, and the Zod schemas every row goes through before main hands it out. A row that
// fails its schema throws (`memoryDb.ts` logs path and code only); the store turns that into a
// failed read or a failed write. Shared by the write side (`memoryStore.ts`) and the read side
// (`memorySearch.ts`).
import { z } from 'zod'
import {
  MEMORY_BASES,
  MEMORY_KINDS,
  MEMORY_STATES,
  MEMORY_WRITERS,
  MemoryItemSchema,
  MemoryRowSchema,
  type MemoryRow
} from '../../shared/schemas/memory'

/** `item` and its current text: the newest version, `seq` breaking a tie on `at`. */
const ITEM_COLUMNS = `item.id, item.kind, item.workspace_id, item.state, item.pinned, item.basis,
  item.check_text, item.folder, item.origin_by, item.origin_session_id, item.origin_deleted_at,
  item.last_seen_at, item.created_at, item.updated_at, item.meta, cur.head, cur.body`
const CURRENT_JOIN = `JOIN version AS cur ON cur.seq = (SELECT v.seq FROM version AS v
  WHERE v.item_id = item.id ORDER BY v.at DESC, v.seq DESC LIMIT 1)`

/** `SELECT <item columns> FROM <from> JOIN <current version>`; `from` names `item`. */
export function selectItems(from = 'item'): string {
  return `SELECT ${ITEM_COLUMNS} FROM ${from} ${CURRENT_JOIN}`
}

export const NEWEST_FIRST = 'item.updated_at DESC, item.rid DESC'

/** `meta` holds everything of `MemoryItem['meta']` but the folder, which is a column. */
const MetaJsonSchema = MemoryItemSchema.options[0].shape.meta.omit({ folder: true })
const MetaColumn = z
  .string()
  .transform((text, ctx): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      // Becomes a row issue (path `meta`), which the store handles as a failed read by code.
      ctx.addIssue({ code: 'custom', message: 'meta_not_json' })
      return z.NEVER
    }
  })
  .pipe(MetaJsonSchema)

const StoredRow = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS),
  workspace_id: z.string().nullable(),
  state: z.enum(MEMORY_STATES),
  pinned: z.union([z.literal(0), z.literal(1)]),
  basis: z.enum(MEMORY_BASES),
  check_text: z.string().nullable(),
  folder: z.string().nullable(),
  origin_by: z.enum(MEMORY_WRITERS),
  origin_session_id: z.string().nullable(),
  origin_deleted_at: z.number().nullable(),
  last_seen_at: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
  meta: MetaColumn,
  head: z.string(),
  body: z.string()
})
type Stored = z.output<typeof StoredRow>

/** A `selectItems()` row as the whole item. */
export const ItemRow = StoredRow.transform((r): z.input<typeof MemoryItemSchema> => {
  const fields = {
    id: r.id,
    workspaceId: r.workspace_id,
    state: r.state,
    pinned: r.pinned === 1,
    basis: r.basis,
    check: r.check_text,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    origin: { by: r.origin_by, sessionId: r.origin_session_id },
    originDeletedAt: r.origin_deleted_at,
    meta: { folder: r.folder, ...r.meta }
  }
  return r.kind === 'specific'
    ? { kind: 'specific', key: r.head, value: r.body, ...fields }
    : { kind: 'fact', title: r.head, body: r.body, ...fields }
}).pipe(MemoryItemSchema)

/** A `selectItems()` row as one list line. */
export const ListRow = StoredRow.transform(
  (r: Stored): MemoryRow => ({
    id: r.id,
    kind: r.kind,
    head: r.head,
    body: r.body,
    updatedAt: r.updated_at,
    basis: r.basis,
    state: r.state,
    pinned: r.pinned === 1,
    workspaceId: r.workspace_id,
    folder: r.folder,
    sessionName: r.meta.sessionName,
    tagIds: r.meta.tagIds,
    originDeletedAt: r.origin_deleted_at
  })
).pipe(MemoryRowSchema)

export const CountRow = z.object({ n: z.number() })
