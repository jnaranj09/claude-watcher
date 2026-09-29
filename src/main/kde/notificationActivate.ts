// What a click on an attention notification does (UX-12 / R29 in docs/reports/2026-09-23-bug-hunt).
//
// It used to only push the session id so the renderer SELECTED the card: no window raise (AR-8),
// no workspace switch, no leaving the focused view. With the window minimized, in another
// workspace, or focused on another session, the click looked like it did nothing. Now:
//   1. raise the window (restore + show + focus) — the click is the operator's own action, the
//      same exception as the Quit guard's raise; a SESSION EVENT still never raises the window;
//   2. push `CH.attentionActivate`; the renderer switches to the session's workspace and opens it
//      (`openFromNotification.ts`).
// The raise comes FIRST and a raise failure never stops the push.
//
// Pure: no electron import (the wiring injects the window calls), never throws. Logs a code and a
// Zod path only — never the id.
import { AttentionActivateSchema } from '../../shared/schemas/watchDelta'
import type { AttentionActivatePayload } from '../../shared/ipc/contract'

export interface NotificationActivateDeps {
  isDestroyed: () => boolean
  /** Restore + show + focus this window. May throw; the throw is contained. */
  raise: () => void
  /** Push the validated payload. A `CH.*` const at the call site (no-literal-channels). */
  send: (payload: AttentionActivatePayload) => void
  log: (message: string) => void
}

export function createNotificationActivate(deps: NotificationActivateDeps): (id: string) => void {
  return (id) => {
    if (deps.isDestroyed()) return
    try {
      deps.raise()
    } catch {
      deps.log('[claude-watcher][notify] code=activate_raise_failed')
    }
    // Validate AT SOURCE before the renderer-facing push (zod-boundaries.md). PATH + CODE only.
    const r = AttentionActivateSchema.safeParse({ id })
    if (!r.success) {
      const issue = r.error.issues[0]
      deps.log(
        `[c9watch][attention] dropped attention:activate path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
      )
      return
    }
    if (!deps.isDestroyed()) deps.send(r.data)
  }
}
