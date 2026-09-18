// Programmatic API — `GET /v1/templates`. The operator's templates, whole, so a caller can pick one
// and build the `args` a create will accept.
//
// The scope filter is STRICT both ways, like the Manage dialog's (design.md "Scoped lists"): a
// workspace scope does NOT merge in the global templates. A global template created through the
// API lands in the ACTIVE workspace, not in the one the caller filtered on, so listing it there
// would promise a placement the create does not keep.
import {
  ApiTemplateListSchema,
  EmptySchema,
  TEMPLATE_SCOPE_GLOBAL,
  TemplatesListQuerySchema
} from '../../../shared/schemas/api'
import { defineCommand } from '../registry'

export const templatesListCommand = defineCommand({
  id: 'templates.list',
  method: 'GET',
  path: '/v1/templates',
  summary: 'List the session templates',
  description:
    'Every template unless `scope` narrows it. The scope is strict: a workspace id returns that ' +
    "workspace's templates only, and `global` returns the templates in no workspace.",
  params: EmptySchema,
  query: TemplatesListQuerySchema,
  body: null,
  output: ApiTemplateListSchema,
  successStatus: 200,
  errorStatuses: [400, 401, 404],
  // No `no_window` gate: the templates store lives in main and answers with or without a window.
  async handler(ctx, { query }) {
    const { scope } = query
    // An unknown id is 404, not `[]`: an empty list would read as "no templates there" when the
    // caller is holding a stale or mistyped workspace id.
    if (
      scope !== undefined &&
      scope !== TEMPLATE_SCOPE_GLOBAL &&
      ctx.workspaces.get(scope) === null
    ) {
      return { ok: false, status: 404, code: 'workspace_not_found' }
    }
    const workspaceId = scope === TEMPLATE_SCOPE_GLOBAL ? null : scope
    const templates = ctx.templates.list()
    const scoped =
      scope === undefined ? templates : templates.filter((t) => t.workspaceId === workspaceId)
    // Fields are PICKED, not spread: a field added to `Template` later must be a decision to
    // publish, not an accident (the `.strict()` output schema would fail a spread closed).
    const body = scoped.map((t) => ({
      id: t.id,
      name: t.name,
      cwd: t.cwd,
      model: t.model,
      permissionMode: t.permissionMode,
      effort: t.effort,
      workspaceId: t.workspaceId,
      initialPrompt: t.initialPrompt,
      params: t.params.map((p) => ({ label: p.label, pattern: p.pattern, maxLength: p.maxLength }))
    }))
    return { ok: true, status: 200, body }
  }
})
