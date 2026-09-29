// Programmatic API — `GET /v1/sessions/{id}/events`. The SSE stream for ONE session: a snapshot
// frame, then that session's own deltas, then `session.removed` — or, when `/clear` moved the card
// to a new id, `session.rebound` (R8) — and the server closes.
//
// EVERY error this route can answer is returned BEFORE `sink.start()`, so it lands as plain JSON
// with a real status code. Once the stream has started there is no response left to put an error
// in: `apiServer.ts` contains a late error (and a late throw) by ending the stream and logging a
// code, which is a strictly worse answer for the caller. So the two refusals — no window, no such
// session — are decided up front, and nothing after `start()` can return an ApiErr.
//
// THE SUBSCRIBE ORDER IS LOAD-BEARING: `start()` → `onEvent` → `sink.onClose(off)` → the snapshot
// send, with NOTHING awaited in between. A client that disconnects inside that window would
// otherwise end the sink before the unsubscribe was registered, parking `off` on a drained array;
// the hub would then hold the subscription for the window's whole life, invisibly — a send on a
// dead sink is a silent no-op, so no frame and no `streams()` count would ever show it. (The
// sink's own already-ended guard in `onClose` is the other half of that fix.) Because everything
// between `start()` and the send is synchronous, no delta can slip ahead of the snapshot either:
// it is always frame id 1.
//
// NEVER-LOG-THE-VALUE: a delta carries a session name and a `projectPath`. Nothing here logs an
// event; the ONE failure it can hit — a delta that no longer fits the wire shape — is logged by
// `projectApiSessionFromEvent` itself, by code, which is why `ctx.log` is handed to it.
// [.claude/rules/zod-boundaries.md; src/main/api/apiSession.ts; src/main/api/apiServer.ts]
import {
  ApiSessionReboundSchema,
  EmptySchema,
  SessionIdParamsSchema
} from '../../../shared/schemas/api'
import { projectApiSessionFromEvent } from '../apiSession'
import { defineCommand } from '../registry'

export const sessionsEventsCommand = defineCommand({
  id: 'sessions.events',
  method: 'GET',
  path: '/v1/sessions/{id}/events',
  summary: 'Server-sent events for one session',
  description:
    '`text/event-stream`. First frame: `event: session.updated` with the current ApiSession. Then every ' +
    'later `session.updated` (ApiSession) and finally ONE of: `session.removed` (ApiSessionRemoved, the ' +
    'card is gone) or `session.rebound` (ApiSessionRebound, `{ id, newId }`: claude changed the ' +
    "session's id — `/clear` — and the card now lives under `newId`; subscribe to that id to keep " +
    'following it). The server closes the stream after either. A `: ping` comment every 15 s. ' +
    '`Last-Event-ID` is ignored (no replay).',
  params: SessionIdParamsSchema,
  query: EmptySchema,
  body: null,
  output: 'text/event-stream',
  successStatus: 200,
  errorStatuses: [401, 404, 503],
  async stream(ctx, { params }, sink) {
    const seam = ctx.seam()
    if (seam === null) return { ok: false, status: 503, code: 'no_window' }
    const current = seam.getSession(params.id)
    if (current === null) return { ok: false, status: 404, code: 'session_not_found' }
    let counter = 0
    sink.start()
    const off = seam.onEvent((event) => {
      if (event.id !== params.id) return
      if (event.type === 'session.rebound') {
        // R8 — the LAST frame: the card moved to `newId`. Never followed on this stream (the
        // caller asked for THIS id) and never sent as `session.removed` (nothing was deleted).
        // Validated at source; a miss ends the stream with no frame and a code-only log.
        const frame = ApiSessionReboundSchema.safeParse({ id: event.id, newId: event.newId })
        if (frame.success) sink.send('session.rebound', frame.data, ++counter)
        else ctx.log('[claude-watcher][api] code=rebound_frame_invalid')
        sink.end()
        return
      }
      if (event.type === 'session.removed') {
        // The last frame of this stream's life: the card is gone, so there is nothing further to
        // report. `end()` runs the close callbacks, which is what drops this very subscription.
        sink.send('session.removed', { id: event.id }, ++counter)
        sink.end()
        return
      }
      // A delta that no longer fits the state-only wire shape is DROPPED, not shipped: the
      // projection is `.strict()` precisely so a new `Session` field shows up as a missing frame
      // rather than as content on the wire. It logs its own code-only line.
      const projected = projectApiSessionFromEvent(event, ctx.log)
      if (projected === null) return
      sink.send('session.updated', projected, ++counter)
    })
    sink.onClose(off)
    sink.send('session.updated', current, ++counter)
    return null
  }
})
