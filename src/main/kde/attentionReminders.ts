// Attention reminders — re-notify while a session stays BLOCKED on you (MAIN process only).
//
// The first alert is the tracker's `attention.raised`, fired once on the needs-you ENTRY edge.
// This module adds up to `reminderCount` more, with doubling gaps, for a session whose status
// stays in REMINDER_STATUSES (a permission prompt or a question). It owns one timer per blocked
// session, is fed every reducer delta from `handleDelta` in src/main/index.ts beside the notifier,
// and has the same per-window lifetime (disposed in teardownWatchFeed).
//
// Reminders stop ONLY when the status leaves the set or the session is removed (spec D-3). Looking
// at the session or clicking the popup does not count: a blocked session is still blocked.
//
// never-crash: nothing throws out of onDelta or a timer. never-log-the-value: id + code only.
// [Source: docs/superpowers/specs/2026-09-10-attention-reminders-design.md]
import { reminderGapMs } from '../../shared/attention/reminderSchedule'
import type { Session } from '../../shared/schemas/session'
import type { ReducerWatchEventsPayload } from '../../shared/ipc/contract'

/** The BLOCKING statuses that get reminders (D-1). `YourTurn` and unknown needs-you statuses
 *  get the first alert only. This is not a status enum — `status` stays unlocked elsewhere. */
export const REMINDER_STATUSES: ReadonlySet<string> = new Set(['NeedsPermission', 'NeedsAttention'])

export interface ReminderSettings {
  reminderCount: number
  reminderFirstDelayMinutes: number
}

export interface AttentionRemindersOptions {
  /** Epoch-millis clock — inject for determinism; defaults to Date.now. */
  now?: () => number
  /** Timer seam — defaults to setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Live settings read (D-9): the count when a reminder is due, the delay when one is armed. */
  getSettings: () => ReminderSettings
  /** The reducer's CURRENT session for an id, read when a reminder is due. */
  getSession: (id: string) => Session | undefined
  /** Fire one reminder. The wiring owns the launched gate, the OS popup and the sound push. */
  remind: (session: Session, info: { waitedMs: number }) => void
  /** Log sink — id + code ONLY. Defaults to console.warn. */
  log?: (message: string) => void
}

export interface AttentionReminders {
  /** Start / keep / cancel the series for this delta's session. Never throws. */
  onDelta(delta: ReducerWatchEventsPayload): void
  /** Clear every armed timer (window teardown). Idempotent. */
  dispose(): void
}

interface Series {
  /** Epoch-millis the session became blocked — `waitedMs` is measured from here. */
  startedAt: number
  /** Reminders already shown in this series. */
  fired: number
  /** The armed timer, or null once the series is FINISHED: still blocked, no more reminders.
   *  The entry is kept so later deltas for the same wait do not restart it (D-7). */
  timer: unknown
}

export function createAttentionReminders(options: AttentionRemindersOptions): AttentionReminders {
  const now = options.now ?? Date.now
  // F2 (final-review fix wave) — the timer seam is a PAIR, chosen together: the default
  // clearTimer casts its handle to a real Node Timeout, which is only valid for a handle the
  // default setTimeout produced. A caller injecting one without the other (e.g. setTimer only)
  // would otherwise hand that cast a foreign handle. So: use the injected pair only when BOTH
  // are given, else fall back to BOTH defaults.
  const { setTimer, clearTimer } =
    options.setTimer !== undefined && options.clearTimer !== undefined
      ? { setTimer: options.setTimer, clearTimer: options.clearTimer }
      : {
          setTimer: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
          clearTimer: (handle: unknown): void =>
            clearTimeout(handle as ReturnType<typeof setTimeout>)
        }
  const log = options.log ?? ((message: string): void => console.warn(message))

  /** id → the session's reminder series. Keyed by the stable id, never pid. */
  const series = new Map<string, Series>()

  function cancel(id: string): void {
    const s = series.get(id)
    if (s === undefined) return
    if (s.timer !== null) clearTimer(s.timer)
    series.delete(id)
  }

  /** Arm the next reminder, or mark the series finished when the count is reached. */
  function arm(id: string, s: Series): void {
    const { reminderCount, reminderFirstDelayMinutes } = options.getSettings()
    if (s.fired >= reminderCount) {
      s.timer = null
      return
    }
    s.timer = setTimer(() => fire(id), reminderGapMs(s.fired + 1, reminderFirstDelayMinutes))
  }

  function fire(id: string): void {
    const s = series.get(id)
    if (s === undefined) return // cancelled or disposed after the timer was armed
    s.timer = null
    try {
      const session = options.getSession(id)
      if (session === undefined) {
        log(`[claude-watcher][reminders] id=${id} code=reminder_session_missing`)
        series.delete(id)
        return
      }
      // Defensive: a leave should already have cancelled the series.
      if (!REMINDER_STATUSES.has(session.status)) {
        series.delete(id)
        return
      }
      // The count is read when a reminder is DUE, so lowering it (or Off) stops the rest (D-9).
      if (s.fired >= options.getSettings().reminderCount) return
      options.remind(session, { waitedMs: now() - s.startedAt })
      s.fired += 1
      arm(id, s)
    } catch {
      // never-crash: this series ends (timer already null; the entry stays so the same wait does
      // not restart). id + code only.
      log(`[claude-watcher][reminders] id=${id} code=reminder_failed`)
    }
  }

  function onDelta(delta: ReducerWatchEventsPayload): void {
    const { event } = delta
    try {
      if (event.type === 'session.removed') {
        cancel(event.id)
        return
      }
      // The reducer never emits attention.raised; ignore it defensively.
      if (event.type !== 'session.updated') return
      if (!REMINDER_STATUSES.has(event.status)) {
        cancel(event.id)
        return
      }
      // Already waiting (D-6: a status change inside the set) or finished (D-7): same wait.
      if (series.has(event.id)) return
      const s: Series = { startedAt: now(), fired: 0, timer: null }
      series.set(event.id, s)
      arm(event.id, s)
    } catch {
      log(`[claude-watcher][reminders] id=${event.id} code=reminder_failed`)
    }
  }

  function dispose(): void {
    for (const s of series.values()) {
      if (s.timer !== null) clearTimer(s.timer)
    }
    series.clear()
  }

  return { onDelta, dispose }
}
