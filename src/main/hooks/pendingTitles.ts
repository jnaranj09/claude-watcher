// Name-sync — the PENDING-TITLE store: one name waiting to be pushed to claude, per session.
//
// The app cannot rename a running claude session directly. What it can do is answer that
// session's next `UserPromptSubmit` hook POST with `hookSpecificOutput.sessionTitle`, which
// claude applies to itself (verified live on 2.1.243: it beat the launch-time `-n` name and
// wrote both claude's transcript `custom-title` line and its `custom-title.json`).
//
// PUSH ONCE, NOT PER PROMPT — the reason `take()` reads AND clears in one call:
// claude's own collision rule is that naming into a name another LIVE session holds gets you
// a suffixed variant (`api` → `api-graceful-unicorn`). If we re-pushed our name on every
// prompt, each push would collide again and mint a FRESH suffix — the session's name would
// churn forever and never settle. Pushing once and then believing the `session_title` that
// comes back makes claude the authority on its own name, which it is. Making the clear part
// of the read is what keeps that structural instead of a discipline someone can forget.
//
// The stored value is OPERATOR CONTENT (a session name) — never logged, on any path.
// [.claude/rules/zod-boundaries.md; spec-claude-session-name-sync.md]

export interface PendingTitles {
  /** Record the name to push to claude on this session's next `UserPromptSubmit`.
   *  A second `set` before the push OVERWRITES — the operator's latest rename is the one
   *  that matters; there is no queue of stale names. */
  set(sessionId: string, name: string): void
  /** Read AND clear this session's pending name. Returns null when nothing is pending
   *  (the common case — most prompts are not preceded by a rename). */
  take(sessionId: string): string | null
  /** Whether this session has a name waiting to be pushed. NON-consuming, unlike `take`.
   *  The read-back consults this: while a push is pending, the `session_title` claude reports
   *  is STALE BY CONSTRUCTION — the payload is built before our response applies the rename —
   *  so believing it would revert the card to the name the operator just changed away from. */
  has(sessionId: string): boolean
  /** Drop a session's pending name without pushing it — for stop/exit removal, so a rename
   *  that raced a stop cannot be pushed to a session that no longer exists. Idempotent. */
  forget(sessionId: string): void
  /** Current pending count (diagnostics / tests). */
  size(): number
}

/** Build an empty pending-title store. One app-global instance (index.ts); tests construct
 *  an isolated instance per case. */
export function createPendingTitles(): PendingTitles {
  const pending = new Map<string, string>()

  return {
    set(sessionId: string, name: string): void {
      // A blank id should never reach here (the rename keys on a validated session id), and a
      // blank name cannot pass SessionNameSchema — but never record a useless entry that would
      // later push an empty title at claude.
      if (sessionId.length === 0 || name.length === 0) return
      pending.set(sessionId, name)
    },

    take(sessionId: string): string | null {
      const name = pending.get(sessionId)
      if (name === undefined) return null
      pending.delete(sessionId) // read-and-clear — this IS the push-once guarantee
      return name
    },

    has(sessionId: string): boolean {
      return pending.has(sessionId)
    },

    forget(sessionId: string): void {
      pending.delete(sessionId)
    },

    size(): number {
      return pending.size
    }
  }
}
