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

/** Parses with MemoryExtractResultSchema, then sends on CH.memoryExtractResult. A payload that fails is
 *  dropped with `code=memory_extract_result_invalid` and its Zod path and issue code. */
// main→renderer, validated at source (zod-boundaries.md). The result carries counts, codes and the
// session's name, never memory or transcript text; the drop log carries no name either. A window
// that is gone gets nothing (a result for it has nowhere to show). Main sends through the hold in
// extractResultPush.ts, which keeps a result until a renderer is ready for it.
export function sendMemoryExtractResult(
  wc: PushTarget,
  result: MemoryExtractResult,
  log: (line: string) => void
): void {
  const parsed = parseExtractResult(result, log)
  if (parsed !== null && !wc.isDestroyed()) wc.send(CH.memoryExtractResult, parsed)
}
