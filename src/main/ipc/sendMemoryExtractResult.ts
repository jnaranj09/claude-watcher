import { CH } from '../../shared/ipc/contract'
import { MemoryExtractResultSchema, type MemoryExtractResult } from '../../shared/schemas/memory'

/** The part of a window's webContents a push needs. */
interface PushTarget {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/** Parses with MemoryExtractResultSchema, then sends on CH.memoryExtractResult. A payload that fails is
 *  dropped with `code=memory_extract_result_invalid` and its Zod path and issue code. */
// main→renderer, validated at source (zod-boundaries.md). The result carries counts, codes and the
// session's name, never memory or transcript text; the drop log carries no name either. A window
// that is gone gets nothing (a result for it has nowhere to show).
export function sendMemoryExtractResult(
  wc: PushTarget,
  result: MemoryExtractResult,
  log: (line: string) => void
): void {
  const r = MemoryExtractResultSchema.safeParse(result)
  if (!r.success) {
    const issue = r.error.issues[0]
    log(
      `[claude-watcher][memory] code=memory_extract_result_invalid path=${issue?.path.join('.') ?? ''} issue=${issue?.code ?? ''}`
    )
    return
  }
  if (!wc.isDestroyed()) wc.send(CH.memoryExtractResult, r.data)
}
