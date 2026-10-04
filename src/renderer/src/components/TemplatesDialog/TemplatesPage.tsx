// Session templates — the Templates PAGE of the Sessions dialog (spec 2026-10-03 F), on the shared
// ManageDialog shell (.claude/rules/design.md). The dialog owns the shell state, the scope and the
// page column; this page owns the "follow a row a save moved" rule. The list and the form are
// separate units. `+ New session` → `Manage templates…` opens the dialog on this page.
import { selectIncludeGlobal, useSettings } from '../../stores/settingsStore'
import { IncludeGlobal } from '../ScopeFilter/IncludeGlobal'
import type { JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import { selectTemplates, useTemplates } from '../../stores/templatesStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import {
  filterByScope,
  hasOrphans,
  knownWorkspaceIds,
  scopeOf,
  type ScopeFilterValue
} from '../ScopeFilter/scope'
import { TemplateForm } from './TemplateForm'
import { TemplateList } from './TemplateList'

export function TemplatesPage({ scope, setScope, pages }: DialogPageProps): JSX.Element {
  // The Manage dialog can show EVERY template regardless of scope (unlike the popover) — no
  // makeSelectVisibleTemplates here. activeWorkspaceId + workspaces feed the header's scope
  // filter, which is the ONE thing that narrows this list.
  const templates = useTemplates(selectTemplates)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const dialog = useManageDialogContext()
  const includeGlobal = useSettings(selectIncludeGlobal)
  const selected = templates.find((t) => t.id === dialog.state.selectedId) ?? null
  const formOpen = dialog.state.creating || selected !== null
  const known = knownWorkspaceIds(workspaces)

  function changeScope(next: ScopeFilterValue): void {
    setScope(next)
    // A row selected in the OLD scope is gone from the list; leaving it in the form means editing
    // something you can no longer see. Close it: the placeholder.
    dialog.actions.select(null)
  }

  /** Keeps a just-saved row visible: changing its Workspace can move it out of the view you
   *  saved it from, and a row that vanishes on save reads as a failed save. */
  function revealSaved(template: Template): void {
    dialog.actions.select(template.id)
    if (filterByScope([template], scope, known, includeGlobal).length === 0) {
      setScope(scopeOf(template.workspaceId, known))
    }
    dialog.actions.showSuccess('Template saved.')
  }

  return (
    <>
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
        <IncludeGlobal scope={scope} testId="template-include-global" />
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <TemplateList templates={templates} workspaces={workspaces} scope={scope} />
        {formOpen ? (
          <TemplateForm
            key={selected?.id ?? 'new'}
            template={selected}
            onSaved={revealSaved}
            onRemoved={() => {
              dialog.actions.select(null)
              dialog.actions.showSuccess('Template deleted.')
            }}
          />
        ) : (
          <ManageDialog.Placeholder testId="template-placeholder">
            Select a template on the left, or create a new one.
          </ManageDialog.Placeholder>
        )}
      </ManageDialog.Columns>
      {/* The ONE message slot, under the columns like every Manage dialog: a delete unmounts
            the form, and its success still has to show. */}
      <ManageDialog.Message testId="template-error" />
    </>
  )
}
