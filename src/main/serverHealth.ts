// Server health — ONE place that knows whether this process's hook ingest and API are really
// listening (UX-05, SEC-6, R11 in docs/reports/2026-09-23-bug-hunt).
//
// Before this, both listeners failed to bind SILENTLY: the hook server logged `code=eaddrinuse`
// and every card sat in Connecting/idle with no alert and no badge; the API logged
// `code=listen_failed` while Settings kept showing its Docs URL. The signals already existed
// (`onListening`, the server `error` event); nothing collected them.
//
// Main reads `hookListening()` before handing claude `--settings` (SEC-6: a port someone else
// holds must never receive our sessions' prompts), and pushes every change of the derived
// state to the renderer, which draws the banner and the Settings line.
//
// Pure: no electron, no IO. `onChange` fires only when the DERIVED state changes.

import type { ApiHealth, HookHealth, ServerHealth } from '../shared/schemas/serverHealth'

export interface ServerHealthState {
  get(): ServerHealth
  /** True only once THIS process's hook server has reported its bind. */
  hookListening(): boolean
  hookBound(): void
  /** A bind/server error on the hook listener (`EADDRINUSE`, …). Never the message. */
  hookFailed(errno: string): void
  /** The window's hook server was closed — the next one starts from scratch. */
  hookClosed(): void
  /** The per-spawn write of the hook settings file succeeded / failed. */
  hookSettingsWritten(ok: boolean): void
  setApi(state: ApiHealth): void
}

export function createServerHealth(opts: {
  hookPort: number
  onChange: (health: ServerHealth) => void
}): ServerHealthState {
  let listening = false
  let bindErrno: string | null = null
  let settingsOk = true
  let api: ApiHealth = 'off'
  let last = derive()

  function hooksState(): HookHealth {
    if (bindErrno !== null) return bindErrno === 'EADDRINUSE' ? 'port_in_use' : 'server_error'
    if (!listening) return 'starting'
    return settingsOk ? 'ok' : 'hooks_file_failed'
  }

  function derive(): ServerHealth {
    return { hooks: hooksState(), hookPort: opts.hookPort, api }
  }

  function update(): void {
    const next = derive()
    if (next.hooks === last.hooks && next.api === last.api) return
    last = next
    opts.onChange(next)
  }

  return {
    get: () => ({ ...last }),
    hookListening: () => listening,
    hookBound() {
      listening = true
      bindErrno = null
      update()
    },
    hookFailed(errno) {
      // A server that never bound has nothing listening; one that bound and then errored is
      // treated the same — whether it still accepts is unknown, and SEC-6 must fail closed.
      listening = false
      bindErrno = errno
      update()
    },
    hookClosed() {
      listening = false
      bindErrno = null
      update()
    },
    hookSettingsWritten(ok) {
      settingsOk = ok
      update()
    },
    setApi(state) {
      api = state
      update()
    }
  }
}
