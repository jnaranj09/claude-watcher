// Memory — the Commands page (memory phase 2, PICK look 5): the shell commands that worked in a
// session, one workspace's (a command has no global row and no state, so the header is the scope
// alone, no `Include global`, no `Show stale`). The rail: the search alone (32px, as the sibling
// pages draw it), then a row per command with the Memory row's three lines (the command in mono,
// its folder, `<n> runs · <age>` with `Session deleted`), and `Show more`. The right column: the
// whole command in History's frame, `Folder`, `Last run`, and `Delete` → `Confirm delete`. Only
// the operator deletes; nothing is created here (no `+ New`). Command text is SENSITIVE: rendered
// as text, never logged.
import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MemoryCommand } from '../../../../shared/schemas/memory'
import { MEMORY_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { folderName } from '../../lib/filterCopy'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { Callout } from '../Callout/Callout'
import { SearchIcon } from '../Icon/MenuIcons'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { relativeEnded } from '../PastSessionsDialog/pastSessionsView'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import { scopeWorkspaceId, type ScopeFilterValue } from '../ScopeFilter/scope'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import { useCommandList } from './useCommandList'
import styles from './MemoryDialog.module.css'

export interface CommandsPageProps {
  pages: ReactNode
  workspaceId: string
  setWorkspaceId: (id: string) => void
  now: () => number
}

export function CommandsPage({
  pages,
  workspaceId,
  setWorkspaceId,
  now
}: CommandsPageProps): JSX.Element {
  const dialog = useManageDialogContext()
  const { actions } = dialog
  const { closeRef } = dialog.meta
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const list = useCommandList({ workspaceId, query: trimmed === '' ? null : trimmed })
  const selected = list.rows.find((c) => c.id === dialog.state.selectedId) ?? null

  // An aria-modal dialog must take focus on mount: the ✕ is the mount-stable target (the search
  // box is not drawn on an empty page).
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  function changeScope(next: ScopeFilterValue): void {
    const id = scopeWorkspaceId(next)
    if (id === null) return // never offered: no unfiltered entry, no Global, no orphans
    setWorkspaceId(id)
    actions.select(null) // design.md — changing the scope closes whatever was open
  }

  const remove = useAsyncAction(async (): Promise<void> => {
    if (selected === null) return
    try {
      await window.memory.removeCommand(selected.id)
      actions.select(null)
      actions.showSuccess(MEMORY_COPY.commandDeleted)
      list.reload()
    } catch (err) {
      console.warn('[claude-watcher][memory] code=memory_command_delete_failed')
      // Main undid it: the command stays listed and open.
      actions.setError(memoryErrorCopy(err, MEMORY_COPY.commandDeleteFailed))
    }
  })

  const searching = trimmed !== ''
  // An empty scope draws no search, as Specifics and Facts do; a search that emptied the list
  // keeps it, so the way back stays in reach.
  const drawSearch = list.rows.length > 0 || searching
  const emptyCopy = searching ? MEMORY_COPY.noMatches : MEMORY_COPY.commandsEmpty

  return (
    <>
      <ManageDialog.Header>
        <ScopeFilter
          value={`ws:${workspaceId}`}
          workspaces={workspaces}
          showGlobal={false}
          showOrphans={false}
          onChange={changeScope}
          testId="memory-scope-filter"
          ariaLabel="Filter memory by workspace"
        />
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.List size="wide">
          {drawSearch && (
            <TextInput
              variant="toolbar"
              icon={<SearchIcon />}
              testId="memory-command-search"
              ariaLabel={MEMORY_COPY.searchCommands}
              placeholder={MEMORY_COPY.search}
              value={query}
              onChange={setQuery}
            />
          )}
          <ManageDialog.Rows>
            {list.rows.map((c) => (
              <ManageDialog.Row
                key={c.id}
                id={c.id}
                testId="memory-command-row"
                selectTestId={`memory-command-select-${c.id}`}
              >
                <CommandRowLines command={c} now={now()} />
              </ManageDialog.Row>
            ))}
            {list.loaded && !list.loadFailed && list.rows.length === 0 && (
              <p className={styles.empty} data-testid="memory-command-empty">
                {emptyCopy}
              </p>
            )}
            {list.loadFailed && (
              <Callout
                tone="danger"
                title={MEMORY_COPY.loadFailed}
                testId="memory-command-load-error"
              />
            )}
            {list.rows.length < list.total && (
              <span className={styles.more}>
                <ManageDialog.GhostButton
                  testId="memory-command-more"
                  size="sm"
                  onClick={list.more}
                >
                  {MEMORY_COPY.showMore}
                </ManageDialog.GhostButton>
              </span>
            )}
          </ManageDialog.Rows>
        </ManageDialog.List>
        {selected !== null ? (
          <ManageDialog.Pane testId="memory-command">
            <p className={`${styles.quote} ${styles.quoteFirst}`} data-testid="memory-command-text">
              {selected.text}
            </p>
            <ManageDialog.Label>{MEMORY_COPY.folder}</ManageDialog.Label>
            <p className={`${styles.value} ${styles.mono}`} title={selected.folder}>
              {selected.folder}
            </p>
            <ManageDialog.Label>{MEMORY_COPY.lastRun}</ManageDialog.Label>
            <p className={styles.value}>{new Date(selected.lastAt).toLocaleString()}</p>
            <ManageDialog.Footer>
              <ManageDialog.Delete
                testId="memory-command-delete"
                busy={remove.busy}
                onConfirm={() => void remove.run()}
              />
            </ManageDialog.Footer>
          </ManageDialog.Pane>
        ) : (
          <ManageDialog.Placeholder testId="memory-command-placeholder">
            {MEMORY_COPY.commandPlaceholder}
          </ManageDialog.Placeholder>
        )}
      </ManageDialog.Columns>
    </>
  )
}

/** A row's three lines: the command (one mono line, `…`, its whole text in `title`), its folder's
 *  name, then `<n> runs · <age>` and `Session deleted` when its last session was deleted. */
function CommandRowLines({ command, now }: { command: MemoryCommand; now: number }): JSX.Element {
  return (
    <span className={styles.rowMain}>
      <span className={`${styles.rowName} ${styles.commandName}`} title={command.text}>
        {command.text}
      </span>
      <span className={styles.rowValue} title={command.folder}>
        {folderName(command.folder)}
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.rowAge}>
          {`${MEMORY_COPY.runs(command.count)} · ${relativeEnded(command.lastAt, now)}`}
        </span>
        {command.sessionDeletedAt !== null && (
          <WorkspaceLabel name={MEMORY_TERMS.sessionDeleted} tone="orphan" />
        )}
      </span>
    </span>
  )
}
