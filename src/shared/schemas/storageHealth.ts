// Storage health — the store files that could not be read or written this run (UX-06, UX-07 in
// docs/reports/2026-09-23-bug-hunt). Main owns it and pushes it over `CH.storageHealth`, validated
// AT SOURCE; the renderer draws one notice under the header from it.
//
// Before this, all of it was a console `code=` only: a corrupt templates file was renamed to
// `.corrupt-<ts>.json` and the app started with NO templates and no word why; a full disk made
// every Save look like it worked, and the rows were gone after a restart.
//
// Store NAME and CODE only — never a path (it leaks the filesystem layout) or a value.
//
// `code`:
//   - corrupt_reset — the file failed its schema: it was backed up and the store started empty
//   - read_failed   — the file could not be read at all: the store started empty
//   - backup_failed — a corrupt file could not even be backed up before the reset
//   - write_failed  — a change that is not a dialog's Save (settings, a workspace switch, a
//                     cascade, the session history) did not reach the disk; it lasts only until
//                     the app closes. A dialog's own Save throws STORE_WRITE_FAILED instead.

import { z } from 'zod'

export const STORE_NAMES = [
  'settings',
  'templates',
  'shortcuts',
  'tags',
  'workspaces',
  'rules',
  'past_sessions'
] as const
export const STORAGE_PROBLEM_CODES = [
  'corrupt_reset',
  'read_failed',
  'backup_failed',
  'write_failed'
] as const

/** Thrown by a store's Save / Delete when the file write fails; the change is ROLLED BACK first,
 *  so what the dialog shows is what is on disk. Each dialog maps it to copy. */
export const STORE_WRITE_FAILED = 'store_write_failed'

export const StorageProblemSchema = z
  .object({
    store: z.enum(STORE_NAMES),
    code: z.enum(STORAGE_PROBLEM_CODES)
  })
  .strict()

export const StorageHealthSchema = z
  .object({
    problems: z.array(StorageProblemSchema).max(STORE_NAMES.length * STORAGE_PROBLEM_CODES.length)
  })
  .strict()

export type StoreName = (typeof STORE_NAMES)[number]
export type StorageProblemCode = (typeof STORAGE_PROBLEM_CODES)[number]
export type StorageProblem = z.infer<typeof StorageProblemSchema>
export type StorageHealth = z.infer<typeof StorageHealthSchema>
