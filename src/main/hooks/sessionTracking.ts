// Per-session hook-side memory — the transcript tail and the background-work verdict — with
// ONE rule for when it starts and ONE for when it ends (R13, SEC-2, SEC-3 in
// docs/reports/2026-09-23-bug-hunt).
//
// START: only for a session the board KNOWS. The :9279 listener takes a POST from anyone on the
// machine (a web page can send one no-cors), and each new id used to attach a tail and a map
// entry that nothing ever removed, and log the caller's raw `session_id` (up to 1 MiB, newlines
// included, so it could forge a `code=` line). The caller runs the `/clear` adoption FIRST, so a
// session under its new id is already known by the time it gets here and keeps its tail.
//
// END: `forget` on every `session.removed` — the one chokepoint every removal passes through,
// the old id of a `/clear` rebind included.

import type { HookEvent } from '../../shared/schemas/hookEvent'
import type { BackgroundWorkState } from './backgroundWorkState'
import type { TranscriptWatcher } from './transcriptWatcher'

export interface SessionTrackingDeps {
  watcher: Pick<TranscriptWatcher, 'watch' | 'unwatch'>
  backgroundWork: Pick<BackgroundWorkState, 'observe' | 'forget'>
  log: (line: string) => void
  warn: (line: string) => void
}

/** Tail this session's transcript and record its background verdict — known ids only. An
 *  unknown id is dropped WITHOUT a log line: it is caller-controlled text. */
export function trackHookEvent(evt: HookEvent, known: boolean, deps: SessionTrackingDeps): void {
  if (!known) return
  // The watcher is idempotent for a path it already follows, so every event can (re)establish
  // the tail. Log the ATTACH once per session — never the path, it embeds the project dir.
  if (evt.transcript_path !== undefined && evt.transcript_path.length > 0) {
    if (deps.watcher.watch(evt.session_id, evt.transcript_path)) {
      deps.log(`[c9watch][hooks] code=transcript_watch session=${evt.session_id}`)
    }
  } else {
    deps.warn(`[c9watch][hooks] code=transcript_path_absent session=${evt.session_id}`)
  }
  // A no-op unless the event carries `background_tasks`.
  deps.backgroundWork.observe(evt.session_id, evt)
}

/** The session is gone: stop its tail and drop its verdict. Idempotent. */
export function forgetSession(sessionId: string, deps: SessionTrackingDeps): void {
  deps.backgroundWork.forget(sessionId)
  deps.watcher.unwatch(sessionId)
}
