// Background tasks — the pure reader for "is work still running past this turn end?"
//
// Claude Code answers this itself, on the very event that needs it. PROBE-VERIFIED on
// claude 2.1.250 through an `http`-type hook, the same kind the app registers:
//
//   nothing running     "background_tasks": []
//   a background shell  "background_tasks": [{ id, type:"shell", status:"running", … }]
//   an armed Monitor    the same shape, also status "running"
//
// WHAT THIS REPLACED. An earlier build reconstructed this fact the hard way: scrape a task
// id out of each tool's `tool_response`, keep a live registry per session, tail the
// session transcript for `<task-notification><status>completed</status>` blocks to remove
// ids, and add an age backstop for completions that never arrived. It worked, and it was
// entirely unnecessary — the payload states the answer outright. The lesson is worth
// keeping: read the whole payload before building machinery to infer part of it.
//
// The transcript watcher survives, but only for the ONE thing no hook reports at all: an
// Esc interrupt, which fires no hook of any kind (probe-verified — 12 events before, 12
// after, and no idle notification even after 90s).
//
// PURE + TOTAL: no I/O, no state, no logging (`background_tasks` carries the operator's
// COMMAND LINES — never log it), and it never throws on a malformed field.
// [.claude/rules/zod-boundaries.md]

import type { HookEvent } from '../../shared/schemas/hookEvent'

/** The one status that means "still going". NOT enum-locked in the other direction: an
 *  unknown/new status reads as NOT running, so a status we have never seen can only cost
 *  an early "your turn", never a session silently stuck on `Working`. */
const RUNNING = 'running'

/**
 * True when this event reports background work still running.
 *
 * Only the `Stop` payload carries `background_tasks`, so in practice this is asked at a
 * turn end; on any event without the field it is simply false.
 */
export function hasRunningBackgroundWork(evt: HookEvent): boolean {
  const tasks = evt.background_tasks
  if (!Array.isArray(tasks)) return false
  return tasks.some(
    (task) =>
      typeof task === 'object' &&
      task !== null &&
      (task as Record<string, unknown>)['status'] === RUNNING
  )
}
