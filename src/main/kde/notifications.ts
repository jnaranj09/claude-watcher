// Story 2.2 — the KDE attention notifier (MAIN process only).
//
// Fires ONE Electron `Notification` (→ libnotify on KDE) per `attention.raised` the
// Story-1.2 tracker emits. INFORMATIONAL ONLY: activating the notification NEVER summons,
// raises, or focuses the cockpit window and sends NO input to the agent (FROZEN F1 / AC-4;
// AR-8 self-raise CUT 2026-06-19). Activation MAY emit the FR-9 in-app jump-to-card signal
// (a renderer `selectedId` view-state push), but that is the WIRING's responsibility (an
// injected `onActivate` callback) — this module constructs no window self-raise anywhere.
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
import type { AttentionRaisedEvent } from '../../shared/ipc/contract'

/**
 * The minimal surface this module needs off an Electron `Notification`. Kept tiny so the
 * test fake implements exactly this — and so NO Electron import sits on the unit-test path.
 * `show()` is the only call we make; activation is wired via `onActivate` on the factory
 * options (NOT a window-raising `.on('click')` handler — AC-4).
 */
export interface NotificationLike {
  show(): void
}

/** The fields the factory needs to construct a notification. `onActivate` is invoked when
 *  the user activates the notification — it may ONLY emit the FR-9 jump-to-card signal
 *  (it must NEVER raise/focus the window — AC-4). The default Electron factory wires it to
 *  the notification's `click` event WITHOUT any `window.show()/.focus()`. */
export interface NotificationOptions {
  title: string
  body: string
  /** Called on activation (click). The wiring passes a handler that emits the in-app
   *  jump-to-card signal; it NEVER raises the window. Optional — omit for a pure alert. */
  onActivate?: () => void
}

/** The injectable factory seam (AC-6). Returns `null` when notifications are unsupported on
 *  this platform (the real factory gates on `Notification.isSupported()`); a `null` return is
 *  a graceful no-op, never an error. */
export type NotificationFactory = (opts: NotificationOptions) => NotificationLike | null

export interface AttentionNotifierOptions {
  /** The notification factory (DI seam). Defaults to the real Electron wrapper below. */
  notificationFactory?: NotificationFactory
  /** Called on activation with the raised event's `id` — the wiring emits the FR-9
   *  jump-to-card signal here. Informational only: it must NEVER raise/focus the window
   *  (AC-4). Optional — omit to fire pure alerts with no activation behavior. */
  onActivate?: (id: string) => void
  /** Log sink — PATH/identity + code only, NEVER a session value (Guardrail #6). Defaults
   *  to console.warn. Injectable so tests can spy without a real console write. */
  log?: (message: string) => void
}

export interface AttentionNotifier {
  /** Fire exactly ONE notification for this `attention.raised`. NEVER throws (never-crash).
   *  Fed ONLY the tracker's raised events, so it never fires on session.updated/removed. */
  notify(raised: AttentionRaisedEvent): void
}

/**
 * The default factory — a thin wrapper over Electron's `Notification`. This is the ONLY
 * place Electron's `Notification` is constructed, and it is NOT on the unit-test path (the
 * test injects its own factory, so this body never runs there). It gates on
 * `Notification.isSupported()` (returns `null` when unsupported → graceful no-op) and wires
 * activation to the `click` event WITHOUT any window self-raise (AC-4) — `click` only invokes
 * the caller's `onActivate`.
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
    // INFORMATIONAL ONLY (AC-4): the click handler ONLY emits the FR-9 jump-to-card signal.
    // It NEVER calls window.show()/.focus()/.restore() or app.focus() — no self-raise.
    n.on('click', () => opts.onActivate?.())
  }
  return n
}

/**
 * Build the notification CONTENT from the frozen `AttentionRaisedEvent` (AC-3). Read ONLY
 * the union's fields — title names the session, body is `projectPath` + (when present)
 * `pendingToolName` VERBATIM (UX-DR22: never re-label a status word). NEVER reach for
 * `pendingToolInput`/`firstPrompt`/`latestMessage` — they are not on the shape (privacy).
 * Exported for the content/privacy unit test.
 */
export function buildNotificationContent(raised: AttentionRaisedEvent): {
  title: string
  body: string
} {
  const title = `${raised.sessionName} needs you`
  // Body = projectPath, plus the pending tool name verbatim when c9watch reported one.
  // (Status words are shown verbatim, never re-labeled — UX-DR22.) Guard on a NON-EMPTY
  // value, not just `!== undefined`: c9watch's `pendingToolName` is `z.string().optional()`
  // ("may be absent/empty"), so an empty string would otherwise leave a dangling "· " tail.
  const body = raised.pendingToolName
    ? `${raised.projectPath} · ${raised.pendingToolName}`
    : raised.projectPath
  return { title, body }
}

/**
 * Create an attention notifier (AC-6). `notify(raised)` fires exactly ONE notification per
 * call (1:1 with the tracker's `attention.raised`), behind the injectable factory, and
 * NEVER throws (never-crash). On any failure it logs `id` + a code ONLY.
 */
export function createAttentionNotifier(options: AttentionNotifierOptions = {}): AttentionNotifier {
  const notificationFactory = options.notificationFactory ?? electronNotificationFactory
  const onActivate = options.onActivate
  // never-log-the-parsed-value: identity (id) + code ONLY — never a session value.
  const log = options.log ?? ((message: string): void => console.warn(message))

  function notify(raised: AttentionRaisedEvent): void {
    try {
      const { title, body } = buildNotificationContent(raised)
      const n = notificationFactory({
        title,
        body,
        // Activation emits the FR-9 jump-to-card signal ONLY (no window raise — AC-4).
        // Bind the id at construction so the handler carries this session's identity.
        ...(onActivate ? { onActivate: () => onActivate(raised.id) } : {})
      })
      // A null factory return = unsupported platform → graceful no-op (never an error).
      n?.show()
    } catch {
      // never-crash (AC-7): one failed notification must not take the board/feed down.
      // Log id + code ONLY — NEVER a session value (Guardrail #6). The id is an opaque UUID.
      log(`[c9watch][notify] id=${raised.id} code=notify_failed`)
    }
  }

  return { notify }
}
