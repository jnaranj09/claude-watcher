// Session templates — the Manage dialog (modal, z 60 like SessionNameDialog). Owns ONLY the
// selection; the list and the form are separate units. UX-DR14: App.tsx guards it against the
// other modals and closes it on the quit guard.
import { useState, type JSX, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import { selectTemplates, useTemplates } from '../../stores/templatesStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
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
import styles from './TemplatesDialog.module.css'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = templates.find((t) => t.id === selectedId) ?? null
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
    setSelectedId(null)
  }

  /** Keeps a just-saved row visible: changing its Workspace can move it out of the view you
   *  saved it from, and a row that vanishes on save reads as a failed save. */
  function revealSaved(template: Template): void {
    setSelectedId(template.id)
    if (filterByScope([template], scope, known).length === 0) {
      setScope(scopeOf(template.workspaceId, known))
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Templates"
      data-testid="templates-overlay"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.panel} data-testid="templates-panel">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <span className={styles.title}>Templates</span>
            <ScopeFilter
              value={scope}
              workspaces={workspaces}
              showOrphans={hasOrphans(templates, known)}
              onChange={changeScope}
              allLabel="All templates"
              testId="template-scope-filter"
              ariaLabel="Filter templates by workspace"
            />
          </div>
          <button
            type="button"
            className={styles.closeButton}
            data-testid="templates-close"
            aria-label="Close templates"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className={styles.columns}>
          <TemplateList
            templates={templates}
            workspaces={workspaces}
            scope={scope}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onNew={() => setSelectedId(null)}
          />
          <TemplateForm
            key={selected?.id ?? 'new'}
            template={selected}
            onSaved={revealSaved}
            onRemoved={() => setSelectedId(null)}
          />
        </div>
      </div>
    </div>
  )
}
