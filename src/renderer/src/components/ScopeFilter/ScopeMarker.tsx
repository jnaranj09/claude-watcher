// Where a config row LIVES (spec 2026-10-03 H) — on every row of Templates, Shortcuts, Tags and
// Rules, in every scope, so the same row always looks the same, and a global row shown in a
// workspace view (Include global) is never mistaken for the workspace's own. The workspace's name
// in its tint, `Global`, or `(no workspace)` when that workspace is gone.
import type { JSX } from 'react'
import type { Workspace } from '../../../../shared/ipc/contract'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import styles from './ScopeMarker.module.css'

export function ScopeMarker({
  workspaceId,
  workspaces
}: {
  workspaceId: string | null
  workspaces: Workspace[]
}): JSX.Element {
  const workspace = workspaceId === null ? null : workspaces.find((w) => w.id === workspaceId)
  return (
    <span className={styles.marker} data-testid="scope-marker">
      {workspaceId === null ? (
        <WorkspaceLabel name="Global" tone="global" />
      ) : workspace !== undefined && workspace !== null ? (
        <WorkspaceLabel name={workspace.name} tone={workspace.color} />
      ) : (
        <WorkspaceLabel name="(no workspace)" tone="orphan" />
      )}
    </span>
  )
}
