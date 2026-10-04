// Active sessions (spec 2026-10-03 D) — the Sessions dialog's page for the LIVE sessions of a scope
// (`All sessions` or one workspace; no Global, no orphans — every session has a workspace).
// "Bulk and per row. That's the whole point" (owner): a checkbox per row and `Select all` for the
// bulk bar, the row itself for the details column — two separate controls. The list is LIVE (the
// same watch deltas as the board): an ended session leaves it and its check; a new one arrives
// unchecked. Main stays the source of truth; this page never writes session state.
import { useEffect, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { exitSessions, type ExitVerb } from '../../lib/sessionExit'
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
import {
  activeEmptyCopy,
  activeRows,
  deleteConsequence,
  exitResultCopy,
  statusAge
} from './activeSessionsView'
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
  // One press, one action (spec 2026-09-29 §2.3): Archive and Delete — bulk or the footer's — share
  // one in-flight flag. Results go to the message slot: inside the dialog there is no toast and no
  // jump to the board (spec D feedback rule).
  const exiting = useAsyncAction(async (verb: ExitVerb, ids: string[]): Promise<void> => {
    dialog.actions.setError(null)
    const outcomes = await exitSessions(verb, ids)
    const landed = new Set(outcomes.filter((o) => o.ok).map((o) => o.id))
    setChecked((prev) => new Set([...prev].filter((id) => !landed.has(id))))
    const copy = exitResultCopy(verb, outcomes)
    if (copy.tone === 'error') {
      // A refused row stays checked and Delete stays armed: one more press retries.
      dialog.actions.setError(copy.text)
      return
    }
    // Every row left: nothing is armed any more, and an open row that left closes (`select` before
    // `showSuccess` — design.md).
    if (dialog.state.selectedId !== null && landed.has(dialog.state.selectedId)) {
      dialog.actions.select(null)
    } else {
      dialog.actions.disarm()
    }
    dialog.actions.showSuccess(copy.text)
  })
  const checkedIds = checkedRows.map((s) => s.id)

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
          {/* The bulk bar: a DIFFERENT region from the list, so behind the divider (design.md rule
              7). Rendered only while a row is checked — a control you cannot use is not drawn. */}
          {checkedRows.length > 0 && (
            <ManageDialog.ListBottomDivided>
              <div className={styles.bulkBar}>
                <span className={styles.bulkCount} data-testid="active-bulk-count">
                  {checkedRows.length} selected
                </span>
                <ManageDialog.GhostButton
                  testId="active-bulk-archive"
                  busy={exiting.busy}
                  onClick={() => void exiting.run('archive', checkedIds)}
                >
                  Archive
                </ManageDialog.GhostButton>
                <ManageDialog.Delete
                  armKey="bulk"
                  testId="active-bulk-delete"
                  busy={exiting.busy}
                  onConfirm={() => void exiting.run('delete', checkedIds)}
                />
              </div>
              {/* StopConfirm cannot open over a dialog (single-modal rule): its sentence moves here. */}
              {dialog.state.armedKey === 'bulk' && (
                <ManageDialog.Hint testId="active-bulk-delete-hint">
                  {deleteConsequence(checkedRows.length)}
                </ManageDialog.Hint>
              )}
            </ManageDialog.ListBottomDivided>
          )}
        </ManageDialog.List>
        <ManageDialog.Placeholder testId="active-session-placeholder">
          Select a session on the left.
        </ManageDialog.Placeholder>
      </ManageDialog.Columns>
      <ManageDialog.Message testId="active-session-error" />
    </>
  )
}
