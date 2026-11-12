// Memory — one PAGE of the Memory dialog (Specifics or Facts; spec 2026-11-11 memory §8, mockup
// option B): the header's scope, `Include global` and `Show stale`; the rail's search and `Filter`
// (MemoryFilters), a row per item with its pin, and `+ New`; on the right the item's form, its
// History, or the placeholder. The list comes from main a page at a time (useMemoryList); an open
// item is read whole (`window.memory.get`) and read again whenever main says memory changed,
// without touching the draft being typed (the form keeps its own state, keyed by the item).
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MemoryGetResult } from '../../../../shared/ipc/contract'
import type { MemoryItem, MemoryRow } from '../../../../shared/schemas/memory'
import { FAVORITE_TERMS, MEMORY_TERMS } from '../../copy/terms'
import { activeFilterCount, effectiveFilters, type SessionFilters } from '../../lib/sessionFilters'
import { selectGoalsIn, useGoals } from '../../stores/goalsStore'
import { selectIncludeGlobal, selectMemoryEnabled, useSettings } from '../../stores/settingsStore'
import { selectTags, useTags } from '../../stores/tagsStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { Callout } from '../Callout/Callout'
import { Checkbox } from '../Checkbox/Checkbox'
import { FavoriteToggle } from '../FavoriteToggle/FavoriteToggle'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { relativeEnded } from '../PastSessionsDialog/pastSessionsView'
import { IncludeGlobal } from '../ScopeFilter/IncludeGlobal'
import includeGlobalStyles from '../ScopeFilter/IncludeGlobal.module.css'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import { ScopeMarker } from '../ScopeFilter/ScopeMarker'
import { scopeWorkspaceId, type ScopeFilterValue } from '../ScopeFilter/scope'
import { railTags } from '../SessionsDialog/railFilters'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { MemoryFilters } from './MemoryFilters'
import { MemoryForm } from './MemoryForm'
import { MemoryHistory } from './MemoryHistory'
import { MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import { toMemoryFilters } from './memoryFilterMap'
import { useMemoryList } from './useMemoryList'
import styles from './MemoryDialog.module.css'

export interface MemoryPageProps {
  kind: MemoryRow['kind']
  /** `Specifics` / `Facts`: History's way back names the page. */
  pageLabel: string
  pages: ReactNode
  workspaceId: string
  setWorkspaceId: (id: string) => void
  showStale: boolean
  setShowStale: (next: boolean) => void
  filters: SessionFilters
  setFilters: (next: SessionFilters) => void
  now: () => number
}

export function MemoryPage({
  kind,
  pageLabel,
  pages,
  workspaceId,
  setWorkspaceId,
  showStale,
  setShowStale,
  filters,
  setFilters,
  now
}: MemoryPageProps): JSX.Element {
  const dialog = useManageDialogContext()
  const { actions } = dialog
  const { closeRef } = dialog.meta
  const includeGlobal = useSettings(selectIncludeGlobal)
  const memoryOn = useSettings(selectMemoryEnabled)
  const tags = useTags(selectTags)
  const goals = useGoals(selectGoalsIn(workspaceId))
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [query, setQuery] = useState('')
  // One workspace, always (no unfiltered entry): a `ws:` scope.
  const scope: `ws:${string}` = `ws:${workspaceId}`

  // The rail's filters: a tag the scope cannot see, or a goal that is gone, drops out at read time.
  const offeredTags = railTags(tags, scope)
  const shown = effectiveFilters(
    filters,
    new Set(offeredTags.map((t) => t.id)),
    new Set(goals.map((g) => g.id))
  )
  const trimmed = query.trim()
  const list = useMemoryList({
    workspaceId,
    includeGlobal,
    kind,
    query: trimmed === '' ? null : trimmed,
    filters: toMemoryFilters(shown, { tags: offeredTags, goals, showStale, now: now() })
  })

  // The open item, read whole. Read again on main's push and after this dialog's own writes, and
  // ONLY then: `actions` is a new object whenever App re-renders (it hands the dialog a new
  // `onClose`), so the read effect reaches it through a ref and never lists it as a dependency.
  const selectedId = dialog.state.selectedId
  const [detail, setDetail] = useState<MemoryGetResult | null>(null)
  const [reads, setReads] = useState(0)
  const actionsRef = useRef(actions)
  useLayoutEffect(() => {
    actionsRef.current = actions
  })
  // History belongs to the item it was opened on: any change of selection closes it (React's
  // "adjust state while rendering" pattern, so no frame shows the old History on the new item).
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const [historySelection, setHistorySelection] = useState(selectedId)
  if (historySelection !== selectedId) {
    setHistorySelection(selectedId)
    setHistoryOf(null)
  }
  useEffect(() => window.memory.onChanged(() => setReads((n) => n + 1)), [])
  useEffect(() => {
    if (selectedId === null) return
    let live = true
    window.memory
      .get(selectedId)
      .then((answer) => {
        if (live) setDetail(answer)
      })
      .catch((err: unknown) => {
        console.warn('[claude-watcher][memory] code=memory_get_failed')
        if (live) actionsRef.current.setError(memoryErrorCopy(err, MEMORY_COPY.loadFailed))
      })
    return () => {
      live = false
    }
  }, [selectedId, reads])

  const item = detail !== null && detail.item.id === selectedId ? detail.item : null

  // An aria-modal dialog must take focus on mount: the ✕ is the mount-stable target (the search
  // box is not drawn on an empty page).
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  function refresh(): void {
    list.reload()
    setReads((n) => n + 1)
  }

  function changeScope(next: ScopeFilterValue): void {
    const id = scopeWorkspaceId(next)
    if (id === null) return // never offered: no unfiltered entry, no Global, no orphans
    setWorkspaceId(id)
    actions.select(null) // design.md — changing the scope closes whatever was open
  }

  /** A save opens the saved item (a new one too) and says so after the `select`. */
  function revealSaved(saved: MemoryItem): void {
    setDetail((d) => ({ item: saved, versions: d?.item.id === saved.id ? d.versions : [] }))
    actions.select(saved.id)
    actions.showSuccess(MEMORY_COPY.saved)
    refresh()
  }

  function deleted(): void {
    actions.select(null)
    actions.showSuccess(MEMORY_COPY.deleted)
    list.reload()
  }

  function restored(): void {
    actions.showSuccess(MEMORY_COPY.restored)
    refresh()
  }

  // The row pin (owner: the pin is on the row, as Templates and Shortcuts pin). Busy per ROW: one
  // pin in flight never holds the others, and the same row never runs twice. A refusal is the
  // dialog's error toast; the row keeps main's state.
  const [pinning, setPinning] = useState<ReadonlySet<string>>(new Set())
  function togglePin(row: MemoryRow): void {
    if (pinning.has(row.id)) return
    setPinning((ids) => new Set(ids).add(row.id))
    actions.setError(null)
    window.memory
      .setPinned(row.id, !row.pinned)
      .then(() => refresh())
      .catch((err: unknown) => {
        console.warn('[claude-watcher][memory] code=memory_pin_failed')
        actions.setError(memoryErrorCopy(err, FAVORITE_TERMS.updateFailed))
      })
      .finally(() =>
        setPinning((ids) => {
          const next = new Set(ids)
          next.delete(row.id)
          return next
        })
      )
  }

  const searching = trimmed !== '' || activeFilterCount(shown) > 0
  // Different nothings, different sentences (design.md). Memory off already says why nothing is
  // saved; a failed load says so in its own Callout.
  const emptyCopy = searching
    ? MEMORY_COPY.noMatches
    : list.anySaved
      ? MEMORY_COPY.onlyStale
      : memoryOn
        ? MEMORY_COPY.empty
        : null
  // An empty scope draws no search and no `Filter` (mockup B5); a search or filter that emptied
  // the list keeps them, so the way back stays in reach.
  const drawFilters = list.anySaved || searching

  function rightColumn(): JSX.Element {
    if (dialog.state.creating) {
      return (
        <MemoryForm
          key="new"
          kind={kind}
          item={null}
          workspaceId={workspaceId}
          onSaved={revealSaved}
          onDeleted={deleted}
          onChanged={refresh}
          onHistory={() => {}}
        />
      )
    }
    if (item !== null && detail !== null && historyOf === item.id) {
      return (
        <ManageDialog.Pane testId="memory-history">
          <MemoryHistory
            key={item.id}
            item={item}
            versions={detail.versions}
            backLabel={pageLabel}
            onBack={() => setHistoryOf(null)}
            onRestored={restored}
            now={now}
          />
        </ManageDialog.Pane>
      )
    }
    if (item !== null) {
      return (
        <MemoryForm
          key={item.id}
          kind={kind}
          item={item}
          workspaceId={workspaceId}
          onSaved={revealSaved}
          onDeleted={deleted}
          onChanged={refresh}
          onHistory={() => setHistoryOf(item.id)}
        />
      )
    }
    return (
      <ManageDialog.Placeholder testId="memory-placeholder">
        {selectedId === null ? MEMORY_COPY.placeholder : MEMORY_COPY.loading}
      </ManageDialog.Placeholder>
    )
  }

  return (
    <>
      <ManageDialog.Header>
        <ScopeFilter
          value={scope}
          workspaces={workspaces}
          showGlobal={false}
          showOrphans={false}
          onChange={changeScope}
          testId="memory-scope-filter"
          ariaLabel="Filter memory by workspace"
        />
        <IncludeGlobal scope={scope} testId="memory-include-global" />
        <span className={includeGlobalStyles.includeGlobal}>
          <Checkbox
            testId="memory-show-stale"
            label={MEMORY_TERMS.showStale}
            checked={showStale}
            onChange={setShowStale}
          />
        </span>
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.List size="wide">
          {!memoryOn && (
            <Callout
              tone="danger"
              title={MEMORY_COPY.offTitle}
              detail={MEMORY_COPY.offDetail}
              testId="memory-off"
            />
          )}
          {drawFilters && (
            <MemoryFilters
              query={query}
              onQuery={setQuery}
              filters={shown}
              onChange={setFilters}
              tags={offeredTags}
              goals={goals}
              folders={list.folders}
              sessionNames={list.sessionNames}
              now={now}
            />
          )}
          <ManageDialog.Rows>
            {list.rows.map((r) => (
              <ManageDialog.Row
                key={r.id}
                id={r.id}
                testId="memory-row"
                selectTestId={`memory-select-${r.id}`}
              >
                <ManageDialog.RowFavorite>
                  <FavoriteToggle
                    name={r.head}
                    favorite={r.pinned}
                    busy={pinning.has(r.id)}
                    onToggle={() => togglePin(r)}
                    testId={`memory-pin-${r.id}`}
                  />
                </ManageDialog.RowFavorite>
                <span className={styles.rowMain}>
                  <span className={styles.rowLine}>
                    <span className={styles.rowName} title={r.head}>
                      {r.head}
                    </span>
                    <ScopeMarker workspaceId={r.workspaceId} workspaces={workspaces} />
                  </span>
                  {/* The value (a fact: its body's first line), machine data in mono; the full
                      text is the title. */}
                  <span className={styles.rowValue} data-testid="memory-row-value" title={r.body}>
                    {r.body.split('\n')[0]}
                  </span>
                  <span className={styles.rowMeta}>
                    <span className={styles.rowAge}>
                      {`${relativeEnded(r.updatedAt, now())} · ${r.basis}`}
                    </span>
                    {r.originDeletedAt !== null && (
                      <WorkspaceLabel name={MEMORY_TERMS.sessionDeleted} tone="orphan" />
                    )}
                    {r.state === 'stale' && (
                      <WorkspaceLabel name={MEMORY_COPY.stale} tone="orphan" />
                    )}
                  </span>
                </span>
              </ManageDialog.Row>
            ))}
            {list.loaded && !list.loadFailed && list.rows.length === 0 && emptyCopy !== null && (
              <p className={styles.empty} data-testid="memory-empty">
                {emptyCopy}
              </p>
            )}
            {list.loadFailed && (
              <Callout tone="danger" title={MEMORY_COPY.loadFailed} testId="memory-load-error" />
            )}
            {list.rows.length < list.total && (
              <span className={styles.more}>
                <ManageDialog.GhostButton testId="memory-more" size="sm" onClick={list.more}>
                  {MEMORY_COPY.showMore}
                </ManageDialog.GhostButton>
              </span>
            )}
          </ManageDialog.Rows>
          <ManageDialog.New testId="memory-new" />
        </ManageDialog.List>
        {rightColumn()}
      </ManageDialog.Columns>
    </>
  )
}
