// Active sessions (spec 2026-10-03 D) — the Sessions dialog's page for the LIVE sessions of a scope
// (`All sessions` or one workspace; no Global, no orphans — every session has a workspace).
// "Bulk and per row. That's the whole point" (owner): a checkbox per row and `Select all` for the
// bulk bar, the row itself for the details column — two separate controls. The list is LIVE (the
// same watch deltas as the board): an ended session leaves it and its check; a new one arrives
// unchecked. Main stays the source of truth; this page never writes session state.
import { useEffect, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { selectSessionsById, useBoard } from '../../stores/boardStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import type { PastScope } from '../PastSessionsDialog/pastSessionsView'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import type { ScopeFilterValue } from '../ScopeFilter/scope'
import { StatusDot } from '../StatusDot/StatusDot'
import { statusLabel } from '../StatusDot/statusLabel'
import { TextInput } from '../TextInput/TextInput'
import pastStyles from '../PastSessionsDialog/PastSessionsDialog.module.css'
import { activeEmptyCopy, activeRows, statusAge } from './activeSessionsView'
import styles from './SessionsDialog.module.css'

export function ActiveSessionsPage({
  scope,
  setScope,
  pages,
  now
}: DialogPageProps & { now: () => number }): JSX.Element {
  const dialog = useManageDialogContext()
  const sessionsById = useBoard(selectSessionsById)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set())
  const searchRef = useRef<HTMLInputElement | null>(null)
  const allRef = useRef<HTMLInputElement | null>(null)

  // The dialog resets Global / `(no workspace)` on the way in (scopeOnPage); this keeps the type honest.
  const activeScope: PastScope = scope === 'global' || scope === 'orphans' ? 'all' : scope
  const sessions = Object.values(sessionsById)
  const inScope = activeRows(sessions, activeScope, '')
  const listed = activeRows(sessions, activeScope, query)
  // Only what is live, visible and checked counts — an ended session has left `listed`.
  const checkedRows = listed.filter((s) => checked.has(s.id))
  const allChecked = listed.length > 0 && checkedRows.length === listed.length
  const someChecked = checkedRows.length > 0 && !allChecked

  // An aria-modal dialog takes focus on mount (TemplateList precedent).
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  // `indeterminate` is a DOM property with no attribute: set it imperatively.
  useEffect(() => {
    if (allRef.current !== null) allRef.current.indeterminate = someChecked
  }, [someChecked])

  function changeScope(next: ScopeFilterValue): void {
    if (next === 'global' || next === 'orphans') return // never offered here
    setScope(next)
    setChecked(new Set()) // checks hidden by the new scope would act unseen
    dialog.actions.select(null) // design.md — changing the scope closes what was open
  }

  function setCheck(id: string, on: boolean): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(): void {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const s of listed) {
        if (allChecked) next.delete(s.id)
        else next.add(s.id)
      }
      return next
    })
  }

  return (
    <>
      <ManageDialog.Header>
        <ScopeFilter
          value={activeScope}
          workspaces={workspaces}
          showGlobal={false}
          showOrphans={false}
          onChange={changeScope}
          allLabel="All sessions"
          testId="active-session-scope-filter"
          ariaLabel="Filter active sessions by workspace"
        />
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.List size="wide">
          <TextInput
            inputRef={searchRef}
            variant="inline"
            testId="active-session-search"
            ariaLabel="Search active sessions"
            placeholder="Search"
            value={query}
            onChange={setQuery}
          />
          {listed.length > 0 && (
            <label className={styles.selectAll}>
              <input
                ref={allRef}
                type="checkbox"
                data-testid="active-select-all"
                checked={allChecked}
                onChange={toggleAll}
              />
              Select all
            </label>
          )}
          <ManageDialog.Rows>
            {listed.map((s) => (
              <ManageDialog.Row
                key={s.id}
                id={s.id}
                testId="active-session-row"
                selectTestId={`active-session-select-${s.id}`}
              >
                <ManageDialog.RowCheck
                  checked={checked.has(s.id)}
                  onChange={(on) => setCheck(s.id, on)}
                  label={`Select ${s.sessionName}`}
                  testId={`active-session-check-${s.id}`}
                />
                <span className={pastStyles.rowMain}>
                  <span
                    className={pastStyles.rowName}
                    data-testid="active-session-name"
                    title={s.sessionName}
                  >
                    {s.sessionName}
                  </span>
                  <StatusDot
                    status={s.column}
                    label={`${statusLabel(s.column)} · ${statusAge(s.enteredColumnAt, now())}`}
                  />
                </span>
              </ManageDialog.Row>
            ))}
            {listed.length === 0 && (
              <p className={pastStyles.empty} data-testid="active-sessions-empty">
                {activeEmptyCopy(sessions.length, inScope.length)}
              </p>
            )}
          </ManageDialog.Rows>
        </ManageDialog.List>
        <ManageDialog.Placeholder testId="active-session-placeholder">
          Select a session on the left.
        </ManageDialog.Placeholder>
      </ManageDialog.Columns>
      <ManageDialog.Message testId="active-session-error" />
    </>
  )
}
