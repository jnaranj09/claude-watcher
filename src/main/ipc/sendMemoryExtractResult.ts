import { CH } from '../../shared/ipc/contract'
import { MemoryExtractResultSchema, type MemoryExtractResult } from '../../shared/schemas/memory'

/** The part of a window's webContents a push needs. */
export interface PushTarget {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/** The result as MemoryExtractResultSchema parses it, or null after a
 *  `code=memory_extract_result_invalid` line with its Zod path and issue code. */
export function parseExtractResult(
  result: MemoryExtractResult,
  log: (line: string) => void
): MemoryExtractResult | null {
  const r = MemoryExtractResultSchema.safeParse(result)
  if (r.success) return r.data
  const issue = r.error.issues[0]
  log(
    `[claude-watcher][memory] code=memory_extract_result_invalid path=${issue?.path.join('.') ?? ''} issue=${issue?.code ?? ''}`
  )
  return null
}

/** Sends a result `parseExtractResult` already parsed on CH.memoryExtractResult (parse once:
 *  the hold in extractResultPush.ts parses before it holds, then sends through here). */
// main→renderer, validated at source (zod-boundaries.md). The result carries counts, codes and the
// session's name, never memory or transcript text; the drop log carries no name either. A window
// that is gone gets nothing (a result for it has nowhere to show).
export function sendMemoryExtractResult(wc: PushTarget, parsed: MemoryExtractResult): void {
  if (!wc.isDestroyed()) wc.send(CH.memoryExtractResult, parsed)
}
