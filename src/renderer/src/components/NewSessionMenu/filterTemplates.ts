// Session templates — the popover's search filter, kept OUT of NewSessionMenu.tsx so the
// component file exports ONLY components (react-refresh/only-export-components, the same split
// as StatusDot/statusLabel.ts and attention/railName.ts). Pure; no store, no IPC.
import type { Template } from '../../../../shared/ipc/contract'

/** Case-insensitive substring match on the template name. A blank query keeps every template. */
export function filterTemplates(templates: Template[], query: string): Template[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return templates
  return templates.filter((t) => t.name.toLocaleLowerCase().includes(needle))
}
