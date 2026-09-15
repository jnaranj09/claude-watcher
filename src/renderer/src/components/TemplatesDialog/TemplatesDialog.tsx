// Session templates — the Manage dialog, on the shared ManageDialog shell (.claude/rules/design.md).
// Owns the scope filter and the "follow a row a save moved" rule; the selection, the armed Delete
// and the error line are the shell's state (useManageDialog). The list and the form are separate
// units. UX-DR14: App.tsx guards it against the other modals and closes it on the quit guard.
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import { selectTemplates, useTemplates } from '../../stores/templatesStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import {
  ALL_SCOPE,
  filterByScope,
  hasOrphans,
  knownWorkspaceIds,
  scopeOf,
  workspaceScope,
  type ScopeFilterValue
} from '../ScopeFilter/scope'
import { TemplateForm } from './TemplateForm'
import { TemplateList } from './TemplateList'

export interface TemplatesDialogProps {
  onClose: () => void
}

export function TemplatesDialog({ onClose }: TemplatesDialogProps): JSX.Element {
  // The Manage dialog can show EVERY template regardless of scope (unlike the popover) — no
  // makeSelectVisibleTemplates here. activeWorkspaceId + workspaces feed the header's scope
  // filter, which is the ONE thing that narrows this list.
  const templates = useTemplates(selectTemplates)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const dialog = useManageDialog({ title: 'Templates', testIdPrefix: 'templates', onClose })
  const selected = templates.find((t) => t.id === dialog.state.selectedId) ?? null
  const known = knownWorkspaceIds(workspaces)
  // Opens on the workspace you are working in — the rows you most likely came to edit. Falls
  // back to the `all` entry if that id names no known workspace, so the select can never sit on
  // an option it does not offer.
  const [scope, setScope] = useState<ScopeFilterValue>(() =>
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? workspaceScope(activeWorkspaceId)
      : ALL_SCOPE
  )

  function changeScope(next: ScopeFilterValue): void {
    setScope(next)
    // A row selected in the OLD scope is gone from the list; leaving it in the form means editing
    // something you can no longer see. Drop back to the empty form instead.
    dialog.actions.select(null)
  }

  /** Keeps a just-saved row visible: changing its Workspace can move it out of the view you
   *  saved it from, and a row that vanishes on save reads as a failed save. */
  function revealSaved(template: Template): void {
    dialog.actions.select(template.id)
    if (filterByScope([template], scope, known).length === 0) {
      setScope(scopeOf(template.workspaceId, known))
    }
  }

  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header>
          <ScopeFilter
            value={scope}
            workspaces={workspaces}
            showOrphans={hasOrphans(templates, known)}
            onChange={changeScope}
            allLabel="All templates"
            testId="template-scope-filter"
            ariaLabel="Filter templates by workspace"
          />
        </ManageDialog.Header>
        <ManageDialog.Columns>
          <TemplateList templates={templates} workspaces={workspaces} scope={scope} />
          <TemplateForm
            key={selected?.id ?? 'new'}
            template={selected}
            onSaved={revealSaved}
            onRemoved={() => dialog.actions.select(null)}
          />
        </ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
