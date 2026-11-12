// Memory — what claude remembers across sessions, and its IPC boundaries (spec 2026-11-11 memory).
// OUR shape: fail-closed, requests `.strict()`. Memory text (key, value, title, body, check, reason,
// query) is SENSITIVE: NEVER log it — issue path + code only.
import { z } from 'zod'
import { MemoryFiltersSchema } from '../memory/filterFields'
import { hasControlChar } from './launch'
import { WorkspaceIdSchema } from './workspace'

export const MEMORY_KINDS = ['specific', 'fact'] as const
export const MEMORY_STATES = ['active', 'stale'] as const
export const MEMORY_BASES = ['observed', 'stated', 'inferred'] as const
export const MEMORY_WRITERS = ['agent', 'extract', 'operator'] as const
export type MemoryWriter = (typeof MEMORY_WRITERS)[number]

export const MEMORY_LIMITS = {
  specificKey: 120,
  specificValue: 500,
  factTitle: 120,
  factBody: 2000,
  check: 300,
  reason: 200,
  query: 200,
  searchLimit: 20,
  listLimit: 100,
  indexChars: 6000
} as const

/** Codes the memory store throws (the renderer maps them to copy, never the message).
 *  `notFound` / `versionNotFound` are refusals; `readFailed` is a read the database failed (the
 *  caller shows it; a write that fails throws `STORE_WRITE_FAILED` instead). */
export const MEMORY_ERROR = {
  notFound: 'memory_not_found',
  versionNotFound: 'memory_version_not_found',
  readFailed: 'memory_read_failed'
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

const StateSchema = z.enum(MEMORY_STATES)
const BasisSchema = z.enum(MEMORY_BASES)
const WriterSchema = z.enum(MEMORY_WRITERS)
const KindSchema = z.enum(MEMORY_KINDS)

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
  FactTextSchema.extend(ItemFields)
])
export type MemoryItem = z.infer<typeof MemoryItemSchema>

/** One list line. `head` is a specific's key or a fact's title. */
export const MemoryRowSchema = z
  .object({
    id: IdSchema,
    kind: KindSchema,
    head: z.string(),
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
    reason: z.string().nullable(),
    head: z.string(),
    body: z.string()
  })
  .strict()
export type MemoryVersion = z.infer<typeof MemoryVersionSchema>

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
          action: z.enum(['pulled', 'saved', 'updated', 'marked_stale']),
          tool: z.string(),
          itemId: z.string().nullable()
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
    // The dialog always shows one page (specifics or facts).
    kind: KindSchema,
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
