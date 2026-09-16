// Programmatic API — `GET /v1/sessions`. The board's cards, as the state-only projection.
//
// The filter is applied HERE rather than in the seam: the seam is one window's session truth and
// hands back everything the board shows, and `workspaceId` is a request-shaped narrowing the
// router already validated (non-empty when present — `?workspaceId=` is a caller bug, not "all").
import {
  ApiSessionListSchema,
  EmptySchema,
  SessionsListQuerySchema
} from '../../../shared/schemas/api'
import { defineCommand } from '../registry'

export const sessionsListCommand = defineCommand({
  id: 'sessions.list',
  method: 'GET',
  path: '/v1/sessions',
  summary: 'List every session card on the board',
  description:
    'Every workspace unless `workspaceId` narrows it. State only: no prompts, no messages, no tool input.',
  params: EmptySchema,
  query: SessionsListQuerySchema,
  body: null,
  output: ApiSessionListSchema,
  successStatus: 200,
  errorStatuses: [401, 503],
  async handler(ctx, { query }) {
    // No window ⇒ no board to list. The API says so rather than inventing an empty one: an
    // empty array and "the app has no window" are different answers to the same request.
    const seam = ctx.seam()
    if (seam === null) return { ok: false, status: 503, code: 'no_window' }
    const all = seam.listSessions()
    const body =
      query.workspaceId === undefined ? all : all.filter((s) => s.workspaceId === query.workspaceId)
    return { ok: true, status: 200, body }
  }
})
