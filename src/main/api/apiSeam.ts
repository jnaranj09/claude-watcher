// Programmatic API — what the API needs from ONE window's session truth, plus the fan-out hub
// that feeds the open SSE streams.
//
// The API never reaches into the reducer or the tracker itself: main already owns that truth and
// already enriches + gates every delta before it ships to the renderer (`.claude/rules/state.md`).
// This interface is that same stage, exposed sideways. A window closing takes its seam with it,
// which is why the whole thing is nullable at the call site (`ApiContext.seam()`): with no window
// there is nothing to list and nothing to launch into, and the API answers `no_window` rather
// than inventing a board.
import type { SessionRemovedEvent, SessionUpdatedEvent } from '../../shared/ipc/contract'
import type { ApiSession } from '../../shared/schemas/api'
import type { LaunchRequest } from '../pty/launchSession'

/**
 * The two deltas an API client cares about. `attention.raised` is NOT here: it is an alert, and
 * the status change that raised it already rides the enriched `session.updated` the client sees.
 * The frozen `AttentionEvent` union is not reshaped — this names a SUBSET of it.
 */
export type ApiSessionEvent = SessionUpdatedEvent | SessionRemovedEvent

/** What the API needs from ONE window's session truth. Built per window in index.ts beside
 *  launchBoardSeams; the API uses the single window's seam. */
export interface ApiSeam {
  listSessions(): ApiSession[]
  getSession(id: string): ApiSession | null
  /** Enriched `session.updated` / `session.removed` deltas, AFTER the board-ship gate — so a
   *  session the board never shows (an external, non-app-launched one) never reaches a client
   *  either. Returns the unsubscribe. */
  onEvent(cb: (event: ApiSessionEvent) => void): () => void
  /** Register the recipe + push `launch:requested`; the renderer's open spawns the pty. */
  requestLaunch(req: LaunchRequest): { terminalId: string; workspaceId: string }
  awaitSessionId(terminalId: string, timeoutMs: number): Promise<string>
}

/** The seam's event side, as an object main can emit into. One hub per window. */
export interface ApiEventHub {
  emit(event: ApiSessionEvent): void
  onEvent(cb: (event: ApiSessionEvent) => void): () => void
  /** Drop every subscriber — the window went away, or the API stopped. */
  clear(): void
}

/**
 * The fan-out. One delta, every open stream.
 *
 * Two things are load-bearing. The iteration copies the set, so a subscriber that unsubscribes
 * (or subscribes) while being notified cannot mutate the collection being walked. And a
 * subscriber that THROWS is caught: an SSE sink writing to a socket the client just dropped must
 * not take the other streams — or the emitting main-process path — down with it (never-crash
 * past the boundary). The catch logs a CODE only: an event carries a session name and a
 * `projectPath`, and an Error thrown from a sink can carry either.
 */
export function createApiEventHub(
  log: (message: string) => void = (m) => console.warn(m)
): ApiEventHub {
  const subscribers = new Set<(event: ApiSessionEvent) => void>()
  return {
    emit(event) {
      for (const cb of [...subscribers]) {
        try {
          cb(event)
        } catch {
          log('[claude-watcher][api] code=subscriber_threw')
        }
      }
    },
    onEvent(cb) {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },
    clear() {
      subscribers.clear()
    }
  }
}
