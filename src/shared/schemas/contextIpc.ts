// Context's IPC (spec 2026-10-18 §4): the argument schemas, the setup state, and the refusal
// codes. The renderer never sends a path: a session id plus a file index into that session's
// report, or a version id. Main resolves the path from its own records (technical-taste §7).
import { z } from 'zod'
import type { ModReport } from './modReport'

/** Why a session has no bridge mod report, set at spawn (`mods/bridgeModSpawn.ts`). */
export const MOD_SKIP_REASONS = ['claude_too_old', 'mod_not_installed', 'listener_down'] as const
export type ModSkipReason = (typeof MOD_SKIP_REASONS)[number]

export type SessionSetupState =
  | { state: 'ready'; report: ModReport }
  | { state: 'waiting' }
  | { state: 'unavailable'; reason: ModSkipReason }

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string }

/** A path Context opens in the editor: absolute. Main still refuses one that can run as a
 *  program (`file_runnable`). A relative path is listed only. */
export const isAbsolutePath = (path: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(path)

/** A path Context keeps versions of and restores: absolute, ending in `.md`. A report can name any
 *  file (an `@` import, or a report another local process forged); the app writes only these. */
export const isInstructionPath = (path: string): boolean =>
  isAbsolutePath(path) && /\.md$/i.test(path)

/** The refusals Context's handlers return; the renderer maps each to copy. */
export const CONTEXT_REFUSAL_CODES = [
  'file_missing',
  'file_open_failed',
  'file_runnable',
  'file_restore_failed',
  'file_too_large',
  'version_not_found',
  'store_write_failed'
] as const
export type ContextRefusalCode = (typeof CONTEXT_REFUSAL_CODES)[number]

export const SessionSetupGetSchema = z.object({ sessionId: z.string().min(1) }).strict()
/** Any integer: an out-of-range index is a refusal (`file_missing`), not a parse error. */
export const FileRefSchema = z
  .object({ sessionId: z.string().min(1), fileIndex: z.number().int() })
  .strict()
export const VersionRefSchema = z.object({ versionId: z.string().min(1) }).strict()
/** The main → renderer push: which session's setup changed; the renderer asks again. */
export const SessionSetupChangedSchema = z.object({ sessionId: z.string().min(1) }).strict()

export type SessionSetupGetRequest = z.infer<typeof SessionSetupGetSchema>
export type FileRef = z.infer<typeof FileRefSchema>
export type VersionRef = z.infer<typeof VersionRefSchema>
export type SessionSetupChanged = z.infer<typeof SessionSetupChangedSchema>
