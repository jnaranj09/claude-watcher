// Story 2.2 — the KDE attention notifier (MAIN process only).
//
// Fires ONE Electron `Notification` (→ libnotify on KDE) per `attention.raised` the
// Story-1.2 tracker emits. It sends NO input to the agent. Activating (clicking) a notification
// calls the injected `onActivate`; the WIRING (`notificationActivate.ts`) raises the window and
// opens the session (UX-12 / R29 in docs/reports/2026-09-23-bug-hunt — this overrides the old
// AR-8 "never raise" cut: a click is the operator's own action, like the Quit guard's raise).
// This module itself touches no window.
//
// FIRES 1:1 off the tracker's already-debounced output (FROZEN F2 / AC-1): the Story-1.2
// per-session ~700ms attention-emission debounce is the SOLE storm-suppression authority for
// the whole Epic-2 fan-out. This module adds NO second/event-level debounce or cooldown.
//
// PRIVACY (AC-3 / AC-7 / Critical Guardrail #6): the notification BODY carries `projectPath`
// + `pendingToolName` VERBATIM over the OS — that is the contract, BY DESIGN. But:
//   - the body NEVER reaches for `pendingToolInput`/`firstPrompt`/`latestMessage` — those are
//     not on the frozen `AttentionRaisedEvent` shape and must never be read here;
//   - any LOG on the notify path logs the `id` (an opaque UUID) + a code ONLY — NEVER
//     `sessionName`/`projectPath`/`pendingToolName`/any session value.
//
// never-crash (PRECEDENCE #2 / AC-7): a notifier failure (libnotify unavailable,
// `Notification.isSupported()` false, a throwing factory) is caught and degraded — one failed
// notification must never take the board/feed down. `notify` NEVER throws.
//
// DI seam (AC-6): the Electron `Notification` is created behind an injectable
// `notificationFactory` so the `main-unit` (node) tests inject a fake — no real OS
// notification, no Electron import on the test path.
// [Source: story 2.2 Tasks 2/3; AC-1/3/4/6/7; FROZEN F1/F2; .claude/rules/{zod-boundaries,ipc}.md]
import { Notification } from 'electron'
import { STATUS_YOUR_TURN } from '../../shared/ipc/contract'
import type { AttentionRaisedEvent } from '../../shared/ipc/contract'

/**
 * The minimal surface this module needs off an Electron `Notification`. Kept tiny so the
 * test fake implements exactly this — and so NO Electron import sits on the unit-test path.
 * `show()` is the only call we make; activation is wired via `onActivate` on the factory
 * options.
 */
export interface NotificationLike {
  show(): void
}

/** The fields the factory needs to construct a notification. `onActivate` is invoked when
 *  the user activates the notification. The default Electron factory wires it to the
 *  notification's `click` event. */
export interface NotificationOptions {
  title: string
  body: string
  /** Called on activation (click). Optional — omit for a pure alert. */
  onActivate?: () => void
}

/** The injectable factory seam (AC-6). Returns `null` when notifications are unsupported on
 *  this platform (the real factory gates on `Notification.isSupported()`); a `null` return is
 *  a graceful no-op, never an error. */
export type NotificationFactory = (opts: NotificationOptions) => NotificationLike | null

export interface AttentionNotifierOptions {
  /** The notification factory (DI seam). Defaults to the real Electron wrapper below. */
  notificationFactory?: NotificationFactory
  /** Called on activation with the raised event's `id` — the wiring raises the window and
   *  opens that session (UX-12 / R29). Optional — omit to fire pure alerts. */
  onActivate?: (id: string) => void
  /** Whether desktop popups are on (`settings.notificationsEnabled`, UX-13). Read on EVERY
   *  notify/remind, so a change applies without a restart. Off = no popup; the sound is a
   *  separate setting in the renderer. Defaults to always on. */
  enabled?: () => boolean
  /** Log sink — PATH/identity + code only, NEVER a session value (Guardrail #6). Defaults
   *  to console.warn. Injectable so tests can spy without a real console write. */
  log?: (message: string) => void
}

export interface AttentionNotifier {
  /** Fire exactly ONE notification for this `attention.raised`. NEVER throws (never-crash).
   *  Fed ONLY the tracker's raised events, so it never fires on session.updated/removed. */
  notify(raised: AttentionRaisedEvent): void
  /** Attention reminders — fire ONE reminder for a session still blocked on you. Same title and
   *  same activation as the first alert; the body adds the minutes waited. NEVER throws. Called
   *  only by the reminder scheduler (src/main/kde/attentionReminders.ts). */
  remind(input: ReminderInput): void
  /** How many shown notifications are still held (R21). For the tests. */
  retainedCount(): number
}

/** How many shown notifications the notifier keeps a reference to (R21). A notification that was
 *  shown and never clicked stays in KDE's history, where a click must still work; past this many
 *  the OLDEST reference is dropped. */
export const MAX_RETAINED_NOTIFICATIONS = 50

/**
 * The default factory — a thin wrapper over Electron's `Notification`. This is the ONLY
 * place Electron's `Notification` is constructed, and it is NOT on the unit-test path (the
 * test injects its own factory, so this body never runs there). It gates on
 * `Notification.isSupported()` (returns `null` when unsupported → graceful no-op) and wires
 * activation to the `click` event — `click` only invokes the caller's `onActivate`.
 *
 * The top-level `import { Notification } from 'electron'` resolves to a path string under a
 * bare node runtime (so `Notification` is `undefined` in the unit test), but the import itself
 * does not throw — and the test injects a fake factory, so this function never executes there.
 * In the real (electron-vite, externalized) main process `Notification` is the real class.
 */
export const electronNotificationFactory: NotificationFactory = (opts) => {
  if (!Notification.isSupported()) return null
  const n = new Notification({ title: opts.title, body: opts.body })
  if (opts.onActivate) {
    n.on('click', () => opts.onActivate?.())
  }
  return n
}

/**
 * The TITLE line per triggering status.
 *
 * `needs-you` is the board COLUMN name — an internal category, not a sentence to say to a
 * human. The notification is read away from the board (often on a phone-sized popup with no
 * card in sight), so it must name WHAT HAPPENED, and every needs-you status has a different
 * answer. The raise already carries the triggering `status`, so nothing extra is plumbed.
 *
 * `status` is NOT enum-locked (`.claude/rules/zod-boundaries.md`) — a brand-new claude status
 * reaches needs-you through the classifier's fail-toward-attention branch, so the `default`
 * arm is a REAL path, not dead code: it must still produce a sane human line.
 *
 * The prose lives here, in the title only. The BODY keeps showing `pendingToolName` VERBATIM
 * (UX-DR22) — this re-labels nothing the operator reads as a status word.
 */
function titleForStatus(sessionName: string, status: string): string {
  switch (status) {
    case STATUS_YOUR_TURN:
      // Claude finished its turn without a question — the operator simply has the floor.
      return `${sessionName} · your turn`
    case 'NeedsAttention':
      // A Stop ending in a prose question, or a blocking AskUserQuestion tool call.
      return `${sessionName} asked a question`
    case 'NeedsPermission':
      // A Notification(permission_prompt) — claude is blocked on an allow/deny.
      return `${sessionName} wants permission`
    default:
      return `${sessionName} is waiting for you`
  }
}

/** Attention reminders — what one reminder needs. The SAME privacy surface as the first alert
 *  (sessionName, projectPath, status, pendingToolName) plus how long the session has waited. It
 *  never crosses IPC, so it is not on the frozen contract. */
export interface ReminderInput {
  id: string
  sessionName: string
  projectPath: string
  status: string
  pendingToolName?: string
  /** Milliseconds since the session became blocked (the start of the reminder series). */
  waitedMs: number
}

/** The body both alerts share: projectPath, plus the pending tool VERBATIM when non-empty. */
function bodyFor(projectPath: string, pendingToolName: string | undefined): string {
  return pendingToolName ? `${projectPath} · ${pendingToolName}` : projectPath
}

/**
 * Build the notification CONTENT from the frozen `AttentionRaisedEvent` (AC-3). Read ONLY
 * the union's fields — title names the session + what happened (per `status`, see
 * `titleForStatus`), body is `projectPath` + (when present) `pendingToolName` VERBATIM
 * (UX-DR22: never re-label a status word). NEVER reach for
 * `pendingToolInput`/`firstPrompt`/`latestMessage` — they are not on the shape (privacy).
 * Exported for the content/privacy unit test.
 */
export function buildNotificationContent(raised: AttentionRaisedEvent): {
  title: string
  body: string
} {
  const title = titleForStatus(raised.sessionName, raised.status)
  // Body = projectPath, plus the pending tool name verbatim when c9watch reported one.
  // (Status words are shown verbatim, never re-labeled — UX-DR22.) `bodyFor` guards on a
  // NON-EMPTY value: an empty string would otherwise leave a dangling "· " tail.
  return { title, body: bodyFor(raised.projectPath, raised.pendingToolName) }
}

/**
 * Attention reminders (spec 2026-09-10 D-10). The title is the first alert's title for the
 * session's CURRENT status, so it reads as the same alert again; the body adds the whole minutes
 * waited. Reads ONLY `ReminderInput` fields (privacy). Exported for the content test.
 */
export function buildReminderContent(input: ReminderInput): { title: string; body: string } {
  const minutes = Math.round(input.waitedMs / 60_000)
  return {
    title: titleForStatus(input.sessionName, input.status),
    body: `${bodyFor(input.projectPath, input.pendingToolName)} · waiting ${minutes} min`
  }
}

/**
 * Create an attention notifier (AC-6). `notify(raised)` fires exactly ONE notification per
 * call (1:1 with the tracker's `attention.raised`), behind the injectable factory, and
 * NEVER throws (never-crash). On any failure it logs `id` + a code ONLY. `remind(input)` fires
 * one reminder popup the same way, for a session still blocked on you.
 */
export function createAttentionNotifier(options: AttentionNotifierOptions = {}): AttentionNotifier {
  const notificationFactory = options.notificationFactory ?? electronNotificationFactory
  const onActivate = options.onActivate
  const enabled = options.enabled ?? ((): boolean => true)
  // R21: a shown Notification nobody references can be garbage-collected, and its click
  // listener goes with it — a click on an older popup then did nothing. Hold each one until it
  // is clicked, capped (oldest dropped first) so a never-clicked series cannot grow forever.
  const retained = new Set<NotificationLike>()
  // never-log-the-parsed-value: identity (id) + code ONLY — never a session value.
  const log = options.log ?? ((message: string): void => console.warn(message))

  /** Build + show one notification. A null factory return = unsupported platform → graceful
   *  no-op. */
  function show(id: string, content: { title: string; body: string }): void {
    const n: NotificationLike | null = notificationFactory({
      ...content,
      ...(onActivate
        ? {
            onActivate: () => {
              if (n !== null) retained.delete(n)
              onActivate(id)
            }
          }
        : {})
    })
    if (n === null) return
    n.show()
    retained.add(n)
    if (retained.size > MAX_RETAINED_NOTIFICATIONS) {
      const oldest = retained.values().next().value
      if (oldest !== undefined) retained.delete(oldest)
    }
  }

  function notify(raised: AttentionRaisedEvent): void {
    if (!enabled()) return
    try {
      show(raised.id, buildNotificationContent(raised))
    } catch {
      // never-crash (AC-7): one failed notification must not take the board/feed down.
      // Log id + code ONLY — NEVER a session value (Guardrail #6). The id is an opaque UUID.
      log(`[c9watch][notify] id=${raised.id} code=notify_failed`)
    }
  }

  function remind(input: ReminderInput): void {
    if (!enabled()) return
    try {
      show(input.id, buildReminderContent(input))
    } catch {
      // never-crash: a failed reminder popup must not end the series or the board. id + code only.
      log(`[claude-watcher][reminders] id=${input.id} code=remind_failed`)
    }
  }

  return { notify, remind, retainedCount: () => retained.size }
}
