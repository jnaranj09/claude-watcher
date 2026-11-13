// The result push's hold (memory phase 2, ruling R38). The start's catch-up runs before the window
// exists, so a result produced while no renderer is ready is HELD here and delivered when a
// window's renderer is ready (index.ts calls `ready` from the window's `did-finish-load`). Held:
// the newest `HELD_EXTRACT_RESULTS_MAX` schema-checked payloads (counts, a name and codes, never
// memory text), flushed once, in order, to the first ready window. A window destroyed and created
// again gets what was held meanwhile when its renderer is ready, then later results at once.
// Nothing here blocks or throws.
import type { MemoryExtractResult } from '../../shared/schemas/memory'
import {
  parseExtractResult,
  sendMemoryExtractResult,
  type PushTarget
} from './sendMemoryExtractResult'

export const HELD_EXTRACT_RESULTS_MAX = 50

export interface ExtractResultPush {
  /** true when the result was sent to a ready window or held for one; false when it failed its
   *  schema (dropped, logged). The once-per-run `claude_version` push counts true as done. */
  push(result: MemoryExtractResult): boolean
  /** A window's renderer is ready: it gets every held result, once, in order, then later ones. */
  ready(wc: PushTarget): void
}

export function createExtractResultPush(log: (line: string) => void): ExtractResultPush {
  const held: MemoryExtractResult[] = []
  const windows = new Set<PushTarget>()

  function liveWindows(): PushTarget[] {
    for (const wc of windows) if (wc.isDestroyed()) windows.delete(wc)
    return [...windows]
  }

  return {
    push(result) {
      const parsed = parseExtractResult(result, log)
      if (parsed === null) return false
      const targets = liveWindows()
      if (targets.length > 0) {
        for (const wc of targets) sendMemoryExtractResult(wc, parsed)
        return true
      }
      held.push(parsed)
      if (held.length > HELD_EXTRACT_RESULTS_MAX) {
        held.shift()
        log('[claude-watcher][memory] code=memory_extract_result_held_dropped')
      }
      return true
    },
    ready(wc) {
      windows.add(wc)
      for (const result of held.splice(0)) sendMemoryExtractResult(wc, result)
    }
  }
}
