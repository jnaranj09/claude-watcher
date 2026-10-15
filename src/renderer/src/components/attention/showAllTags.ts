// Rail "Show all tags" (owner, 2026-10-15) — remembered per workspace in
// `settings.showAllTagsByWorkspace` (workspace id → `true`; a missing key is off).

/** The map to save after the operator turns "Show all tags" `on` or off in `workspaceId`. Only
 *  `true` is stored, and ids of workspaces that no longer exist are dropped, so a deleted
 *  workspace's choice does not outlive it. */
export function nextShowAllTags(
  current: Readonly<Record<string, true>>,
  workspaceId: string,
  on: boolean,
  knownWorkspaceIds: ReadonlySet<string>
): Record<string, true> {
  const next: Record<string, true> = {}
  for (const id of Object.keys(current)) {
    if (id !== workspaceId && knownWorkspaceIds.has(id)) next[id] = true
  }
  if (on) next[workspaceId] = true
  return next
}
