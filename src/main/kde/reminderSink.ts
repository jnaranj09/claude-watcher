// F1 (final-review fix wave) — the reminder SINK: the `remind` callback `createAttentionReminders`
// calls when a series fires, extracted out of `src/main/index.ts` into a small pure factory so it
// is tested directly instead of only via a copy of its body living in a test fixture.
//
// Behavior is byte-for-byte what the inline callback did: (a) the SAME launched-only gate as the
// first alert (Story 3.3 — one membership rule for every attention consumer), (b) push the OS
// popup via `notifier.remind`, (c) re-check the window per send, (d) validate-at-source before the
// renderer-facing push (`.claude/rules/zod-boundaries.md`: main → renderer delta = validate at
// source), dropping + logging PATH + CODE ONLY on a miss (never a session value — Guardrail #6),
// (e) `send` the validated payload.
// [Source: .superpowers/sdd/2026-09-10-attention-reminders/final-fix-brief.md F1]
import { AttentionReminderSchema } from '../../shared/schemas/watchDelta'
import type { AttentionReminderPayload } from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'
import type { AttentionNotifier } from './notifications'

export interface ReminderSinkOptions {
  /** The same launched-only membership rule as the first alert (Story 3.3). */
  isLaunched: (id: string) => boolean
  /** Only the method this sink calls — keeps the test surface minimal. */
  notifier: Pick<AttentionNotifier, 'remind'>
  /** Push the validated payload to the window. A `CH.*` const at the call site (no-literal-channels). */
  send: (payload: AttentionReminderPayload) => void
  isDestroyed: () => boolean
  /** Log sink — PATH + CODE only, NEVER a session value. Defaults to console.warn. */
  log?: (message: string) => void
}

/**
 * Build the `remind` callback `createAttentionReminders` invokes when a reminder is due.
 * [Source: final-fix-brief.md F1]
 */
export function createReminderSink(
  options: ReminderSinkOptions
): (session: Session, info: { waitedMs: number }) => void {
  const log = options.log ?? ((message: string): void => console.warn(message))

  return function remind(session, { waitedMs }) {
    // The SAME launched-only gate as the first alert (Story 3.3): one membership rule for
    // every attention consumer.
    if (!options.isLaunched(session.id)) return
    options.notifier.remind({
      id: session.id,
      sessionName: session.sessionName,
      projectPath: session.projectPath,
      status: session.status,
      waitedMs,
      ...(session.pendingToolName !== undefined ? { pendingToolName: session.pendingToolName } : {})
    })
    if (options.isDestroyed()) return
    // Validate AT SOURCE before send (renderer-facing push). PATH + CODE only on a miss.
    const r = AttentionReminderSchema.safeParse({ id: session.id })
    if (!r.success) {
      const issue = r.error.issues[0]
      log(
        `[claude-watcher][reminders] dropped attention:reminder path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
      )
      return
    }
    options.send(r.data)
  }
}
