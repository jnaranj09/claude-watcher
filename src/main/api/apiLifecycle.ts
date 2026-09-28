// Programmatic API — start/stop/restart the listener from the settings store.
//
// A pure state machine over an INJECTED `start`, so `index.ts` holds one line per event
// (`apiLifecycle.apply(next)` on every settings patch, `stop()` on quit) and the decision of
// whether that patch means anything lives here, unit-tested, with nothing from Electron in reach.
//
// Two properties this exists to hold:
//   - `apply` is IDEMPOTENT. Every settings patch calls it, including the ones that only changed
//     the font size, so it compares the requested port and does nothing when nothing moved — a
//     needless restart drops every open SSE stream out from under its client.
//   - Nothing here throws. A `start` that throws (the listener could not be constructed) and a
//     `close` that throws are both contained and logged as a CODE, leaving the lifecycle STOPPED
//     so the next `apply` retries rather than short-circuiting on a stale entry. This is main's
//     settings handler and its quit path; a throw out of either is a broken app.
//
// R11 — a bind failure is ASYNC: `listen()` returns, and `EADDRINUSE` arrives later on the
// server's `error` event. Until that was wired here the lifecycle kept its entry, believed it was
// running, and short-circuited every later `apply` — the API stayed down until a restart. The
// `onError` callback now clears the entry (so the next apply retries) and reports the state.
//
// NEVER-LOG-THE-VALUE: a caught error is reported by code alone — a bind error's message carries
// the host and port, and it says nothing the code does not.
// [.claude/rules/zod-boundaries.md; src/main/api/apiServer.ts]

import type { ApiHealth } from '../../shared/schemas/serverHealth'

/** The handle `start` hands back. `ApiServer` (apiServer.ts) satisfies it structurally. */
interface ListenerHandle {
  close(): void
}

/** The listener we own while running. `boundPort` fills in when the bind reports. */
interface RunningListener {
  requestedPort: number
  handle: ListenerHandle | null
  boundPort: number | null
}

export interface ApiLifecycle {
  /** Idempotent: start when enabled and not running; stop when disabled; restart on a port change. */
  apply(settings: { apiEnabled: boolean; apiPort: number }): void
  stop(): void
  /** The BOUND port while listening, else null (tests, Task 16's OpenAPI `servers[0].url`, a
   *  future Settings indicator). Null until `onListening` reports, so it never advertises a port
   *  the listener asked for but never got. */
  port(): number | null
}

export function createApiLifecycle(opts: {
  start: (
    port: number,
    onListening: (port: number) => void,
    onError: (errno: string) => void
  ) => ListenerHandle
  log?: (message: string) => void
  /** Every state the listener passes through, for Settings (server health, R11). */
  onState?: (state: ApiHealth) => void
}): ApiLifecycle {
  const log = opts.log ?? ((message: string): void => console.warn(message))
  const report = opts.onState ?? ((): void => {})
  let running: RunningListener | null = null

  function stop(): void {
    const entry = running
    if (entry === null) return
    // Clear FIRST: a `close` that throws must still leave us stopped, or a restart would give up
    // half-way and every later `apply` would short-circuit against a listener that is gone.
    running = null
    try {
      entry.handle?.close()
    } catch {
      log('[claude-watcher][api] code=close_failed')
    }
    log('[claude-watcher][api] code=stopped')
    report('off')
  }

  function apply(settings: { apiEnabled: boolean; apiPort: number }): void {
    if (!settings.apiEnabled) {
      stop()
      report('off') // also after a failed bind, when there was no entry for `stop` to clear
      return
    }
    if (running !== null && running.requestedPort === settings.apiPort) return
    stop()
    const entry: RunningListener = {
      requestedPort: settings.apiPort,
      handle: null,
      boundPort: null
    }
    running = entry
    report('starting')
    try {
      // The bind callback closes over `entry`, never over `running`, so a report that arrives
      // after a stop or a restart lands on the dead entry instead of reopening `port()` — and
      // says nothing, or the log would announce a listener the operator just turned off.
      entry.handle = opts.start(
        settings.apiPort,
        (port) => {
          entry.boundPort = port
          if (running !== entry) return
          log(`[claude-watcher][api] code=listening port=${port}`)
          report('listening')
        },
        (errno) => {
          // Same dead-entry rule. The server already logged `listen_failed errno=`; here the
          // entry is dropped so the next `apply` — even with the same port — starts again.
          if (running !== entry) return
          running = null
          try {
            entry.handle?.close()
          } catch {
            log('[claude-watcher][api] code=close_failed')
          }
          report(errno === 'EADDRINUSE' ? 'port_in_use' : 'failed')
        }
      )
    } catch {
      running = null
      log('[claude-watcher][api] code=listen_failed')
      report('failed')
    }
  }

  return {
    apply,
    stop,
    port: () => running?.boundPort ?? null
  }
}
