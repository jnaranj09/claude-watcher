// Memory — what claude remembers across sessions, and its IPC boundaries (spec 2026-11-11 memory).
// OUR shape: fail-closed, requests `.strict()`. Memory text (key, value, title, body, check, reason,
// query) is SENSITIVE: NEVER log it — issue path + code only.
import { z } from 'zod'
import { MemoryFiltersSchema } from '../memory/filterFields'
import { hasControlChar } from './launch'
import { WorkspaceIdSchema } from './workspace'

/** What a tool or the dialog writes. */
export const MEMORY_KINDS = ['specific', 'fact'] as const
/** Every kind an item can be: an episode is written only by extraction (phase 2). */
export const MEMORY_ITEM_KINDS = ['specific', 'fact', 'episode'] as const
export type MemoryItemKind = (typeof MEMORY_ITEM_KINDS)[number]
export const MEMORY_STATES = ['active', 'stale'] as const
export const MEMORY_BASES = ['observed', 'stated', 'inferred'] as const
export const MEMORY_WRITERS = ['agent', 'extract', 'operator'] as const
export type MemoryWriter = (typeof MEMORY_WRITERS)[number]

export const MEMORY_LIMITS = {
  specificKey: 120,
  specificValue: 500,
  factTitle: 120,
  factBody: 2000,
  episodeTitle: 120,
  episodeBody: 2000,
  sourceQuote: 500,
  commandText: 500,
  check: 300,
  reason: 200,
  query: 200,
  searchLimit: 20,
  listLimit: 100,
  indexChars: 6000,
  /** The index's hard ceiling: pinned lines may pass `indexChars`, never this (the index rides
   *  one argv string, and Linux caps one at 128 KiB). */
  indexCeilingChars: 24_000
} as const

/** Codes the memory store throws (the renderer maps them to copy, never the message).
 *  `notFound` / `versionNotFound` are refusals; `readFailed` is a read the database failed (the
 *  caller shows it; a write that fails throws `STORE_WRITE_FAILED` instead); `unavailable` is
 *  every IPC handler but `activity` while main has no memory store (`memoryIpc.ts`). */
export const MEMORY_ERROR = {
  notFound: 'memory_not_found',
  versionNotFound: 'memory_version_not_found',
  readFailed: 'memory_read_failed',
  unavailable: 'memory_unavailable',
  commandNotFound: 'memory_command_not_found'
} as const

/** Not `.uuid()` — existence is the store's call (`memory_not_found`). */
const IdSchema = z.string().min(1)

const CONTROL_CHARS = { error: 'must not contain control characters' }

function singleLine(max: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !hasControlChar(v), CONTROL_CHARS)
}

/** A fact body keeps its line breaks (`\n`); every other control character is refused. */
function multiLine(max: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !hasControlChar(v.replaceAll('\n', '')), CONTROL_CHARS)
}

const CheckSchema = singleLine(MEMORY_LIMITS.check).nullable()

const SpecificTextSchema = z
  .object({
    kind: z.literal('specific'),
    key: singleLine(MEMORY_LIMITS.specificKey),
    value: singleLine(MEMORY_LIMITS.specificValue)
  })
  .strict()
const FactTextSchema = z
  .object({
    kind: z.literal('fact'),
    title: singleLine(MEMORY_LIMITS.factTitle),
    body: multiLine(MEMORY_LIMITS.factBody)
  })
  .strict()
export const MemoryTextSchema = z.discriminatedUnion('kind', [SpecificTextSchema, FactTextSchema])
export type MemoryText = z.infer<typeof MemoryTextSchema>

/** What a session did, written by extraction only: never a text a tool or the dialog saves. */
export const EpisodeTextSchema = z
  .object({
    kind: z.literal('episode'),
    title: singleLine(MEMORY_LIMITS.episodeTitle),
    body: multiLine(MEMORY_LIMITS.episodeBody),
    endedAt: z.number()
  })
  .strict()
export type EpisodeText = z.infer<typeof EpisodeTextSchema>

/** Where in the transcript an extracted item came from: the entry and the words it quotes. */
export const MemorySourceSchema = z
  .object({
    entryId: z.string().min(1),
    quote: z.string().min(1).max(MEMORY_LIMITS.sourceQuote)
  })
  .strict()
export type MemorySource = z.infer<typeof MemorySourceSchema>

const StateSchema = z.enum(MEMORY_STATES)
const BasisSchema = z.enum(MEMORY_BASES)
const WriterSchema = z.enum(MEMORY_WRITERS)
const ItemKindSchema = z.enum(MEMORY_ITEM_KINDS)

const ItemFields = {
  id: IdSchema,
  // null = global.
  workspaceId: WorkspaceIdSchema.nullable(),
  state: StateSchema,
  pinned: z.boolean(),
  basis: BasisSchema,
  check: CheckSchema,
  lastSeenAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  origin: z.object({ by: WriterSchema, sessionId: z.string().min(1).nullable() }).strict(),
  originDeletedAt: z.number().nullable(),
  // null = not extracted, or extracted before sources were kept.
  source: MemorySourceSchema.nullable(),
  meta: z
    .object({
      folder: z.string().min(1).nullable(),
      sessionName: z.string().min(1).nullable(),
      tagIds: z.array(z.string().min(1)),
      templateId: z.string().min(1).nullable(),
      goalId: z.string().min(1).nullable(),
      taskIds: z.array(z.string().min(1))
    })
    .strict()
}

export const MemoryItemSchema = z.discriminatedUnion('kind', [
  SpecificTextSchema.extend(ItemFields),
  FactTextSchema.extend(ItemFields),
  EpisodeTextSchema.extend(ItemFields)
])
export type MemoryItem = z.infer<typeof MemoryItemSchema>

/** One list line. `head` is a specific's key or a fact's or episode's title; `body` its current
 *  value or body (the newest version's text, the same `MemoryVersion.body` holds). */
export const MemoryRowSchema = z
  .object({
    id: IdSchema,
    kind: ItemKindSchema,
    head: z.string(),
    body: z.string(),
    updatedAt: z.number(),
    basis: BasisSchema,
    state: StateSchema,
    pinned: z.boolean(),
    workspaceId: WorkspaceIdSchema.nullable(),
    folder: z.string().min(1).nullable(),
    sessionName: z.string().min(1).nullable(),
    tagIds: z.array(z.string().min(1)),
    originDeletedAt: z.number().nullable()
  })
  .strict()
export type MemoryRow = z.infer<typeof MemoryRowSchema>

export const MemoryVersionSchema = z
  .object({
    at: z.number(),
    by: WriterSchema,
    // The basis of this version's text; a restore brings it back with the text.
    basis: BasisSchema,
    reason: z.string().nullable(),
    head: z.string(),
    body: z.string()
  })
  .strict()
export type MemoryVersion = z.infer<typeof MemoryVersionSchema>

/** Why extraction dropped a candidate (an activity entry's `reason`). */
export const DROP_REASONS = [
  'evidence_not_found',
  'secret',
  'invalid',
  'operator_item',
  'tasks_off'
] as const
export type DropReason = (typeof DROP_REASONS)[number]

export const MemoryActivitySchema = z
  .object({
    injected: z
      .object({ tokens: z.number(), itemIds: z.array(z.string().min(1)) })
      .strict()
      .nullable(),
    entries: z.array(
      z
        .object({
          at: z.number(),
          action: z.enum(['pulled', 'saved', 'updated', 'marked_stale', 'dropped']),
          tool: z.string(),
          itemId: z.string().nullable(),
          // Why extraction dropped a candidate; null on every other action.
          reason: z.enum(DROP_REASONS).nullable()
        })
        .strict()
    )
  })
  .strict()
export type MemoryActivity = z.infer<typeof MemoryActivitySchema>

// IPC requests (renderer → main), all `.strict()`.

export const MemoryListSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    includeGlobal: z.boolean(),
    // The dialog always shows one page.
    kind: ItemKindSchema,
    query: singleLine(MEMORY_LIMITS.query).nullable(),
    filters: MemoryFiltersSchema,
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MEMORY_LIMITS.listLimit)
  })
  .strict()

export const MemoryGetSchema = z.object({ id: IdSchema }).strict()

export const MemoryCreateSchema = z
  .object({ workspaceId: WorkspaceIdSchema.nullable(), text: MemoryTextSchema, check: CheckSchema })
  .strict()

export const MemoryEditSchema = z
  .object({ id: IdSchema, text: MemoryTextSchema, check: CheckSchema })
  .strict()

export const MemorySetStateSchema = z.object({ id: IdSchema, state: StateSchema }).strict()

export const MemorySetPinnedSchema = z.object({ id: IdSchema, pinned: z.boolean() }).strict()

export const MemoryDeleteSchema = z.object({ id: IdSchema }).strict()

export const MemoryRestoreSchema = z.object({ id: IdSchema, versionAt: z.number() }).strict()

export const MemoryActivityGetSchema = z.object({ sessionId: IdSchema }).strict()

/** `memory:session-count` and `memory:delete-session`: the items one session saved (the session
 *  Delete confirm asks how many, and deletes them when the operator ticks its box). */
export const MemoryOfSessionSchema = z.object({ sessionId: IdSchema }).strict()

export type MemoryListRequest = z.infer<typeof MemoryListSchema>
export type MemoryCreateRequest = z.infer<typeof MemoryCreateSchema>
export type MemoryEditRequest = z.infer<typeof MemoryEditSchema>
export type MemoryState = z.infer<typeof StateSchema>

/** `memory:changed` (main → renderer) says only that something changed; the renderer lists again. */
export const MemoryChangedSchema = z.object({}).strict()
export type MemoryChanged = z.infer<typeof MemoryChangedSchema>

const CountSchema = z.number().int().min(0)

/** What one save from a session wrote, by kind. */
export const MemoryCountsSchema = z
  .object({ specifics: CountSchema, facts: CountSchema, tasks: CountSchema, episodes: CountSchema })
  .strict()
export type MemoryCounts = z.infer<typeof MemoryCountsSchema>
export const NO_COUNTS: MemoryCounts = { specifics: 0, facts: 0, tasks: 0, episodes: 0 }

/** A shell command a session ran in a folder, counted. `text` is SENSITIVE like memory text. */
export const MemoryCommandSchema = z
  .object({
    id: IdSchema,
    workspaceId: WorkspaceIdSchema,
    folder: z.string().min(1),
    text: z.string().min(1).max(MEMORY_LIMITS.commandText),
    count: CountSchema,
    lastAt: z.number(),
    sessionDeletedAt: z.number().nullable()
  })
  .strict()
export type MemoryCommand = z.infer<typeof MemoryCommandSchema>

export const MemoryCommandsListSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    query: singleLine(MEMORY_LIMITS.query).nullable(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MEMORY_LIMITS.listLimit)
  })
  .strict()

export const MemoryCommandDeleteSchema = z.object({ id: IdSchema }).strict()

/** What started a save from a session. */
export const MEMORY_EXTRACT_TRIGGERS = ['end', 'checkpoint', 'catchup'] as const

/** `memory:extract-result` (main → renderer): how one save from a session went. Counts and a
 *  name only, no memory text. */
export const MemoryExtractResultSchema = z
  .object({
    sessionName: z.string().min(1),
    trigger: z.enum(MEMORY_EXTRACT_TRIGGERS),
    outcome: z.enum(['saved', 'nothing', 'failed']),
    counts: MemoryCountsSchema,
    reason: z.literal('claude_version').nullable()
  })
  .strict()
export type MemoryExtractResult = z.infer<typeof MemoryExtractResultSchema>
