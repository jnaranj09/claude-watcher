// Session templates — the Manage dialog's grouping, kept OUT of TemplateList.tsx so the
// component file stays render-only (the same split as filterTemplates.ts). Pure; no React, no
// store.
import type { Template, Workspace } from '../../../../shared/ipc/contract'

export interface TemplateGroup {
  /** React key. `'global' | 'active' | <workspace id> | 'orphans'`. */
  id: string
  label: string
  templates: Template[]
}

const ORPHANS_LABEL = '(no workspace)'

/**
 * Partitions templates for the Manage dialog — the ONE place every template is visible
 * regardless of scope (contrast `makeSelectVisibleTemplates`, which the popover and the
 * matcher use to show only what is usable now).
 *
 * Order: Global, then the active workspace's own rows, then rows scoped to another EXISTING
 * workspace (one group per workspace, in workspace-list order), then `(no workspace)` for rows
 * whose `workspaceId` matches no known workspace — reachable ONLY here, so a hand-edited file
 * cannot silently put a stranger's template on the operator's menu. Empty groups are omitted.
 */
export function groupTemplates(
  templates: Template[],
  activeWorkspaceId: string,
  workspaces: Workspace[]
): TemplateGroup[] {
  const knownIds = new Set(workspaces.map((w) => w.id))
  const groups: TemplateGroup[] = []

  const global = templates.filter((t) => t.workspaceId === null)
  if (global.length > 0) groups.push({ id: 'global', label: 'Global', templates: global })

  const active = templates.filter((t) => t.workspaceId === activeWorkspaceId)
  if (active.length > 0) {
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
    groups.push({ id: 'active', label: workspace?.name ?? activeWorkspaceId, templates: active })
  }

  for (const w of workspaces) {
    if (w.id === activeWorkspaceId) continue
    const rows = templates.filter((t) => t.workspaceId === w.id)
    if (rows.length > 0) groups.push({ id: w.id, label: w.name, templates: rows })
  }

  const orphans = templates.filter(
    (t) =>
      t.workspaceId !== null && t.workspaceId !== activeWorkspaceId && !knownIds.has(t.workspaceId)
  )
  if (orphans.length > 0) {
    groups.push({ id: 'orphans', label: ORPHANS_LABEL, templates: orphans })
  }

  return groups
}
