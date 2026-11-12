// Workspaces — the scoped-config cascade (D-9). Runs ONLY after a delete was allowed and committed
// (`workspaces.ts` calls index.ts's `cascade`, which hands the stores in here). Memory goes before
// past sessions: the records past sessions drops are reported to memory (`onDropped`), and by then
// the workspace's own items are gone, so only global ones are marked `Session deleted`. A store
// that does not exist (memory off, one that failed to build) is skipped. The rule engines hear of
// it last.
interface CascadeStep {
  removeByWorkspace(workspaceId: string): unknown
}

export interface WorkspaceCascade {
  templates: CascadeStep | null
  shortcuts: CascadeStep | null
  tags: CascadeStep | null
  rules: CascadeStep | null
  goals: CascadeStep | null
  /** Never throws: the delete is already committed (`memoryStartup.ts`). */
  memory: CascadeStep | null
  /** Records are tied by workspace id. */
  pastSessions: CascadeStep | null
  onRulesRemoved: () => void
}

export function cascadeWorkspaceDelete(workspaceId: string, stores: WorkspaceCascade): void {
  const steps = [
    stores.templates,
    stores.shortcuts,
    stores.tags,
    stores.rules,
    stores.goals,
    stores.memory,
    stores.pastSessions
  ]
  for (const step of steps) step?.removeByWorkspace(workspaceId)
  stores.onRulesRemoved()
}
