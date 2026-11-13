// The bodies the `watcher-memory` mod sends to main, and main's answers (memory phase 3). Main
// parses each body here, fail-closed and `.strict()`; the mod builds the same bodies by hand. A
// recall or remember text is SENSITIVE like memory text: never log it, issue path + code only.
import { z } from 'zod'
import { MEMORY_LIMITS } from './memory'

/** A conversation window: the mod's count, bumped at each session end and compact. */
const WindowSchema = z.number().int().min(0).max(1_000_000)
/** claude's own word for who sent a prompt; not enum-locked. */
const OriginSchema = z.string().max(64)

export const ModMemoryIndexSchema = z
  .object({ version: z.literal(1), window: WindowSchema })
  .strict()

export const ModMemoryRecallSchema = z
  .object({
    version: z.literal(1),
    window: WindowSchema,
    origin: OriginSchema,
    text: z.string().min(1).max(MEMORY_LIMITS.recallPromptChars)
  })
  .strict()

export const ModMemoryAtUseSchema = z
  .object({
    version: z.literal(1),
    window: WindowSchema,
    folders: z.array(z.string().min(1).max(4096)).min(1).max(MEMORY_LIMITS.atUseFolders)
  })
  .strict()

/** An empty text parses: main answers `remember_empty`, so the operator gets that copy. */
export const ModMemoryRememberSchema = z
  .object({
    version: z.literal(1),
    origin: OriginSchema,
    text: z.string().max(MEMORY_LIMITS.rememberChars)
  })
  .strict()

/** Why main refused a `/remember`. */
export const REMEMBER_REFUSALS = [
  'memory_not_available',
  'remember_empty',
  'remember_too_long',
  'remember_invalid',
  'remember_secret',
  'remember_not_operator',
  'store_write_failed'
] as const
export type RememberRefusal = (typeof REMEMBER_REFUSALS)[number]

export type ModMemoryIndex = z.infer<typeof ModMemoryIndexSchema>
export type ModMemoryRecall = z.infer<typeof ModMemoryRecallSchema>
export type ModMemoryAtUse = z.infer<typeof ModMemoryAtUseSchema>
export type ModMemoryRemember = z.infer<typeof ModMemoryRememberSchema>

/** The section's answer: the index text, and the folders holding a specific it did not list. */
export type ModMemoryIndexAnswer = { ok: true; text: string; folders: string[] } | { ok: false }
/** A recall or at-use answer: the block to add, or nothing. */
export type ModMemoryTextAnswer = { ok: true; text: string } | { ok: false }
export type ModMemoryRememberAnswer =
  | { ok: true; kind: 'specific' | 'fact'; id: string }
  | { ok: false; code: RememberRefusal }
