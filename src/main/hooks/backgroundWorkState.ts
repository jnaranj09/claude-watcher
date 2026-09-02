// The per-session memory of claude's last background-work verdict.
//
// WHY THIS EXISTS. Two probe-verified facts collide (claude 2.1.250):
//
//   1. `background_tasks` rides `Stop` ONLY. `UserPromptSubmit`, `PreToolUse`,
//      `PostToolUse` and `Notification` arrive without it.
//   2. Pressing Esc fires NO hook of any kind.
//
// So at the instant the operator interrupts a turn, the app has no live way to ask whether
// a background shell is still running. The Esc handler used to demote the card to idle
// unconditionally — which is a FALSE IDLE whenever a background build is still going, the
// exact failure the background-work feature exists to prevent. This module keeps the last
// verdict claude actually stated, so the interrupt can consult it.
//
// STALENESS IS BOUNDED AND DELIBERATELY ONE-SIDED. The verdict is only as fresh as the last
// `Stop`. If work finished during the turn that was then interrupted, no `Stop` reported it
// and the card holds `Working` until the operator's next turn ends. That is the cheaper
// error: a stale "Working" is seen by someone at the keyboard about to type, whereas a
// false "idle" is seen by someone who walked away trusting the board.
//
// PURE + TOTAL: in-memory only, no I/O, no logging (`background_tasks` carries the
// operator's COMMAND LINES — never log it), and it never throws.
// [.claude/rules/state.md — session truth is main's; .claude/rules/zod-boundaries.md]

import { hasRunningBackgroundWork, reportsBackgroundTasks } from './backgroundTasks'
import type { HookEvent } from '../../shared/schemas/hookEvent'

export interface BackgroundWorkState {
  /** Record what an event says. Events that state no verdict are IGNORED, so a mid-turn
   *  `PreToolUse` cannot wipe what the last `Stop` reported. */
  observe: (sessionId: string, evt: HookEvent) => void
  /** The last stated verdict for this session; false for a session never reported on. */
  isRunning: (sessionId: string) => boolean
  /** Drop a session (it was removed). Ids are UUIDs and never reused, so this is hygiene
   *  rather than correctness — but an unbounded map over a long-lived app is still a leak. */
  forget: (sessionId: string) => void
}

export function createBackgroundWorkState(): BackgroundWorkState {
  const running = new Set<string>()
  return {
    observe: (sessionId, evt) => {
      if (!reportsBackgroundTasks(evt)) return // no verdict stated — keep what we know
      if (hasRunningBackgroundWork(evt)) running.add(sessionId)
      else running.delete(sessionId)
    },
    isRunning: (sessionId) => running.has(sessionId),
    forget: (sessionId) => {
      running.delete(sessionId)
    }
  }
}
