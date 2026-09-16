// Programmatic API — `GET /v1/sessions/{id}`. One card by its stable id.
//
// Identity here is the launch-minted session UUID, never a pid (`.claude/rules/zod-boundaries.md`).
// An UNKNOWN id is a 404, not a shape failure: `SessionIdParamsSchema` only asks for a non-empty
// string precisely so "no such session" is answered by this handler and reads as `session_not_found`
// rather than `invalid_request`.
import { ApiSessionSchema, EmptySchema, SessionIdParamsSchema } from '../../../shared/schemas/api'
import { defineCommand } from '../registry'

export const sessionsGetCommand = defineCommand({
  id: 'sessions.get',
  method: 'GET',
  path: '/v1/sessions/{id}',
  summary: 'One session card by its stable id',
  params: SessionIdParamsSchema,
  query: EmptySchema,
  body: null,
  output: ApiSessionSchema,
  successStatus: 200,
  errorStatuses: [401, 404, 503],
  async handler(ctx, { params }) {
    // No window ⇒ nothing to look in. `no_window` (503, retryable) and `session_not_found`
    // (404, terminal) are different answers; collapsing them would tell a client to give up on
    // an id that is fine.
    const seam = ctx.seam()
    if (seam === null) return { ok: false, status: 503, code: 'no_window' }
    const session = seam.getSession(params.id)
    if (session === null) return { ok: false, status: 404, code: 'session_not_found' }
    return { ok: true, status: 200, body: session }
  }
})
