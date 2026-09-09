// Phrase shortcuts — the Manage dialog's grouping. Exact mirror of
// TemplatesDialog/groupTemplates.ts. Pure; no React, no store.
import type { Shortcut, Workspace } from '../../../../shared/ipc/contract'

export interface ShortcutGroup {
  /** React key. `'global' | 'active' | <workspace id> | 'orphans'`. */
  id: string
  label: string
  shortcuts: Shortcut[]
}

const ORPHANS_LABEL = '(no workspace)'

/**
 * Partitions shortcuts for the Manage dialog — the ONE place every shortcut is visible
 * regardless of scope (contrast `makeSelectVisibleShortcuts`, which the terminal matcher uses
 * to fire only what is usable now).
 *
 * Order: Global, then the active workspace's own rows, then rows scoped to another EXISTING
 * workspace (one group per workspace, in workspace-list order), then `(no workspace)` for rows
 * whose `workspaceId` matches no known workspace — reachable ONLY here, so a hand-edited file
 * cannot silently put a stranger's shortcut on the operator's matcher. Empty groups are omitted.
 */
export function groupShortcuts(
  shortcuts: Shortcut[],
  activeWorkspaceId: string,
  workspaces: Workspace[]
): ShortcutGroup[] {
  const knownIds = new Set(workspaces.map((w) => w.id))
  const groups: ShortcutGroup[] = []

  const global = shortcuts.filter((s) => s.workspaceId === null)
  if (global.length > 0) groups.push({ id: 'global', label: 'Global', shortcuts: global })

  const active = shortcuts.filter((s) => s.workspaceId === activeWorkspaceId)
  if (active.length > 0) {
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
    groups.push({ id: 'active', label: workspace?.name ?? activeWorkspaceId, shortcuts: active })
  }

  for (const w of workspaces) {
    if (w.id === activeWorkspaceId) continue
    const rows = shortcuts.filter((s) => s.workspaceId === w.id)
    if (rows.length > 0) groups.push({ id: w.id, label: w.name, shortcuts: rows })
  }

  const orphans = shortcuts.filter(
    (s) =>
      s.workspaceId !== null && s.workspaceId !== activeWorkspaceId && !knownIds.has(s.workspaceId)
  )
  if (orphans.length > 0) {
    groups.push({ id: 'orphans', label: ORPHANS_LABEL, shortcuts: orphans })
  }

  return groups
}
