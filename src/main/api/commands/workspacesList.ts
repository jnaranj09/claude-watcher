// Programmatic API — `GET /v1/workspaces`. Every workspace in saved order, with the active one
// marked, so a caller can tell where a GLOBAL template's session will land.
//
// Fields are PICKED, not spread: `defaultCwd` stays off the wire, and a field added to `Workspace`
// later cannot ride out through a spread (the `.strict()` output schema would fail it closed).
import { ApiWorkspaceListSchema, EmptySchema } from '../../../shared/schemas/api'
import { defineCommand } from '../registry'

export const workspacesListCommand = defineCommand({
  id: 'workspaces.list',
  method: 'GET',
  path: '/v1/workspaces',
  summary: 'List every workspace',
  description:
    '`active` marks the workspace the operator is looking at — where a session created from a global template lands.',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: ApiWorkspaceListSchema,
  successStatus: 200,
  errorStatuses: [400, 401],
  // No `no_window` gate: the workspaces store lives in main and answers with or without a window.
  async handler(ctx) {
    const activeId = ctx.workspaces.activeId()
    const body = ctx.workspaces.list().map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
      active: w.id === activeId
    }))
    return { ok: true, status: 200, body }
  }
})
