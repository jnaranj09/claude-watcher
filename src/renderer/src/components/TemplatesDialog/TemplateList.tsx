// Session templates — the Manage dialog's LEFT column: search + the row list + "+ New". The rows
// and "+ New" are ManageDialog parts, so the selection is the shell's state (TemplatesDialog.tsx
// creates it) rather than props threaded through here.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Template, Workspace } from '../../../../shared/ipc/contract'
import { filterTemplates } from '../NewSessionMenu/filterTemplates'
import { filterByScope, knownWorkspaceIds, type ScopeFilterValue } from '../ScopeFilter/scope'
import { ManageDialog } from '../ManageDialog/ManageDialog'
import { TextInput } from '../TextInput/TextInput'
import { selectTemplatesLoadFailed, useTemplates } from '../../stores/templatesStore'
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
}

export function TemplateList({ templates, workspaces, scope }: TemplateListProps): JSX.Element {
  const [query, setQuery] = useState('')
  const loadFailed = useTemplates(selectTemplatesLoadFailed)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // An aria-modal dialog must take focus on mount, or Escape/Tab keep going to whatever was
  // focused behind it (a11y defect). Mount-only, like SessionNameDialog's input focus.
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const known = knownWorkspaceIds(workspaces)
  const scoped = filterByScope(templates, scope, known, false)
  const filtered = filterTemplates(scoped, query)

  // Three different nothings, three different answers: no templates at all, none in the scope you
  // picked, or none matching what you typed. One shared "No matches" would send you looking for a
  // typo when the real answer is the dropdown.
  // A failed startup load is a fourth: it must not read as "none yet" (spec 2026-09-29 §2.6).
  const emptyCopy = loadFailed
    ? 'Could not load templates.'
    : templates.length === 0
      ? 'No templates yet'
      : scoped.length === 0
        ? 'No templates in this workspace'
        : 'No matches'

  return (
    <ManageDialog.List>
      <TextInput
        inputRef={searchRef}
        variant="inline"
        testId="template-search"
        ariaLabel="Search templates"
        placeholder="Search"
        value={query}
        onChange={setQuery}
      />
      <ManageDialog.Rows>
        {filtered.map((t) => (
          <ManageDialog.Row
            key={t.id}
            id={t.id}
            testId="template-row"
            dataAttributes={{ 'data-template-id': t.id }}
          >
            {t.name}
          </ManageDialog.Row>
        ))}
        {filtered.length === 0 && <p className={styles.empty}>{emptyCopy}</p>}
      </ManageDialog.Rows>
      <ManageDialog.New testId="template-new" />
    </ManageDialog.List>
  )
}
