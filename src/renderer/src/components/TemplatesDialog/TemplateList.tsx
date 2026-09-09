// Session templates — the Manage dialog's LEFT column: search + the row list + "+ New". Pure
// props (no store, no IPC); TemplatesDialog.tsx owns the selection and passes the rows down.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Template, Workspace } from '../../../../shared/ipc/contract'
import { filterTemplates } from '../NewSessionMenu/filterTemplates'
import { groupTemplates } from './groupTemplates'
import styles from './TemplatesDialog.module.css'

export interface TemplateListProps {
  templates: Template[]
  /** Workspaces (Task 11) — grouping context. The Manage dialog shows EVERY template (unlike
   *  the popover), organized under Global / the active workspace / other workspaces / orphans. */
  activeWorkspaceId: string
  workspaces: Workspace[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function TemplateList({
  templates,
  activeWorkspaceId,
  workspaces,
  selectedId,
  onSelect,
  onNew
}: TemplateListProps): JSX.Element {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  // An aria-modal dialog must take focus on mount, or Escape/Tab keep going to whatever was
  // focused behind it (a11y defect). Mount-only, like SessionNameDialog's input focus.
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const filtered = filterTemplates(templates, query)
  const groups = groupTemplates(filtered, activeWorkspaceId, workspaces)
  return (
    <div className={styles.list}>
      <input
        ref={searchRef}
        type="text"
        className={styles.input}
        data-testid="template-search"
        aria-label="Search templates"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.rows}>
        {groups.map((g) => (
          <div
            key={g.id}
            className={styles.group}
            data-testid={g.id === 'orphans' ? 'template-group-orphans' : undefined}
          >
            <p className={styles.groupLabel}>{g.label}</p>
            {g.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.row}
                data-testid="template-row"
                data-template-id={t.id}
                data-selected={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className={styles.empty}>
            {templates.length === 0 ? 'No templates yet' : 'No matches'}
          </p>
        )}
      </div>
      <button
        type="button"
        className={styles.ghostButton}
        data-testid="template-new"
        onClick={onNew}
      >
        + New
      </button>
    </div>
  )
}
