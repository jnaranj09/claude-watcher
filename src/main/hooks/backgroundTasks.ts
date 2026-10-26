// Background tasks — the pure reader for "is work still running past this turn end?"
//
// Claude Code answers this itself, on the very event that needs it. PROBE-VERIFIED on
// claude 2.1.250 through an `http`-type hook, the same kind the app registers:
//
//   nothing running     "background_tasks": []
//   a background shell  "background_tasks": [{ id, type:"shell", status:"running", … }]
//   an armed Monitor    the same shape, also status "running"
//   an artifact watch   type "monitor", status "running" — NOT work (claude 2.1.308, see
//                       ARTIFACT_WATCH)
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

/** How claude 2.1.308 describes an artifact watch, whole: `live updates for artifact <url>
 *  (<why it was armed>)` — `auto-armed on publish`, `watch requested`, `re-armed on session
 *  resume`… (none holds a bracket). The watch is an ambient `monitor_ws` task that never ends by
 *  itself, and claude leaves ambient watches out of its own "still running" checks. The Stop
 *  payload drops the `ambient` flag, so the watch arrives as a running "monitor" and this text is
 *  the only thing that tells it apart from a real Monitor (probe, 2026-10-22). Matching the whole
 *  text, not a prefix, keeps a real Monitor from being skipped. Changed wording reads as running
 *  work (the card says Working again, never idle with real work running);
 *  `npm run test:claude-drift` fails first, after a claude upgrade. */
const ARTIFACT_WATCH = /^live updates for artifact https:\/\/\S+\/artifact\/\S+ \([^()]+\)$/

/**
 * True when this event reports background work still running.
 *
 * Only the `Stop` payload carries `background_tasks`, so in practice this is asked at a
 * turn end; on any event without the field it is simply false.
 */
export function hasRunningBackgroundWork(evt: HookEvent): boolean {
  return runningTasks(evt).length > 0
}

/**
 * The ids of the background work still running at this turn end (same filter as
 * `hasRunningBackgroundWork`). A running task with no string id is left out: it can never be told
 * apart from the work running when a sticky ask opened, so it never clears one.
 */
export function runningTaskIds(evt: HookEvent): string[] {
  return runningTasks(evt).flatMap((fields) => {
    const id = fields['id']
    return typeof id === 'string' ? [id] : []
  })
}

function runningTasks(evt: HookEvent): Record<string, unknown>[] {
  const tasks = evt.background_tasks
  if (!Array.isArray(tasks)) return []
  return tasks.filter((task): task is Record<string, unknown> => {
    if (typeof task !== 'object' || task === null) return false
    const fields = task as Record<string, unknown>
    return fields['status'] === RUNNING && !isArtifactWatch(fields)
  })
}

/** An artifact watch is not work: claude sits at the prompt while it waits for comments. */
function isArtifactWatch(fields: Record<string, unknown>): boolean {
  const description = fields['description']
  return (
    fields['type'] === 'monitor' &&
    typeof description === 'string' &&
    ARTIFACT_WATCH.test(description)
  )
}
