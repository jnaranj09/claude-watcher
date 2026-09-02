// `session:launch-from-template` — the renderer sends an id + the operator's session name;
// MAIN resolves cwd / model / permissionMode from its own validated store, so flag values never
// cross the seam. Parse first (untrusted arg), then look up (existence is the store's call).
import { SessionLaunchFromTemplateSchema } from '../../shared/schemas/launch'
import { TEMPLATE_ERROR, type TemplatesStore } from '../persistence/templates'
import type { LaunchRequest } from './launchSession'

export function resolveTemplateLaunch(store: TemplatesStore, raw: unknown): LaunchRequest {
  const { templateId, name } = SessionLaunchFromTemplateSchema.parse(raw)
  const template = store.get(templateId)
  if (template === null) throw new Error(TEMPLATE_ERROR.notFound)
  return {
    cwd: template.cwd,
    name,
    flags: { model: template.model, permissionMode: template.permissionMode }
  }
}
