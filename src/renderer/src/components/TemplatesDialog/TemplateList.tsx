// Session templates — the Manage dialog's LEFT column: search + the row list + "+ New". Pure
// props (no store, no IPC); TemplatesDialog.tsx owns the selection and passes the rows down.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Template, Workspace } from '../../../../shared/ipc/contract'
import { filterTemplates } from '../NewSessionMenu/filterTemplates'
import { filterByScope, knownWorkspaceIds, type ScopeFilterValue } from '../ScopeFilter/scope'
import { TextInput } from '../TextInput/TextInput'
import styles from './TemplatesDialog.module.css'

export interface TemplateListProps {
  templates: Template[]
  /** Workspaces (Task 11) — the id set the scope filter resolves against, so a row whose
   *  workspace is gone is filed under `(no workspace)` rather than a scope that does not exist. */
  workspaces: Workspace[]
  /** The header dropdown's value. The list is ALWAYS flat: which workspace a row belongs to is
   *  the form's Workspace field, and repeating it as a section header said the same thing twice
   *  while costing the rail a third of its height. */
  scope: ScopeFilterValue
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function TemplateList({
  templates,
  workspaces,
  scope,
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
  const known = knownWorkspaceIds(workspaces)
  const scoped = filterByScope(templates, scope, known)
  const filtered = filterTemplates(scoped, query)

  function row(t: Template): JSX.Element {
    return (
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
    )
  }

  // Three different nothings, three different answers: no templates at all, none in the scope you
  // picked, or none matching what you typed. One shared "No matches" would send you looking for a
  // typo when the real answer is the dropdown.
  const emptyCopy =
    templates.length === 0
      ? 'No templates yet'
      : scoped.length === 0
        ? 'No templates in this workspace'
        : 'No matches'

  return (
    <div className={styles.list}>
      <TextInput
        inputRef={searchRef}
        testId="template-search"
        ariaLabel="Search templates"
        placeholder="Search"
        value={query}
        onChange={setQuery}
      />
      <div className={styles.rows}>
        {filtered.map(row)}
        {filtered.length === 0 && <p className={styles.empty}>{emptyCopy}</p>}
      </div>
      <button
        type="button"
        className={`${styles.ghostButton} ${styles.newButton}`}
        data-testid="template-new"
        onClick={onNew}
      >
        + New
      </button>
    </div>
  )
}
