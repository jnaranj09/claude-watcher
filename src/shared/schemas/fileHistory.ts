// File history's index (spec 2026-10-18 §3): `<userData>/claude-watcher-file-history/index.json`.
// A persisted file read is a fail-closed boundary: a bad index is backed up and the history
// starts fresh (zod-boundaries.md). Content lives beside it in `blobs/<sha256>`.
import { z } from 'zod'

export const FILE_HISTORY_FILE_VERSION = 1

export const FileVersionSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(),
    seenAt: z.number().int().nonnegative()
  })
  .strict()

export const FileHistoryIndexSchema = z
  .object({
    version: z.literal(FILE_HISTORY_FILE_VERSION),
    versions: z.array(FileVersionSchema)
  })
  .strict()

export type FileVersion = z.infer<typeof FileVersionSchema>
export type FileHistoryIndex = z.infer<typeof FileHistoryIndexSchema>
