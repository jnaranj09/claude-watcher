// Past sessions (D-6) — the Past PAGE of the Sessions dialog (spec 2026-10-03 E), on ManageDialog: a header scope
// filter (`All sessions` · each workspace — no Global, no orphans: every record has a workspace
// and the delete cascade keeps it so), a search box over the NAME, a FLAT list newest first, a
// READ-ONLY form, and a [Forget] [Open] footer. Importing a session the app did not
// launch is the dialog's Import page. No `+ New` (there is nothing to create) and no
// RowActions. UX-DR14: App.tsx guards it against the other modals and closes it on the quit
// guard. Never logs a record value.
import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { PastSession, Workspace } from '../../../../shared/ipc/contract'
import { PAST_SESSIONS_MAX } from '../../../../shared/schemas/pastSession'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import type { ScopeFilterValue } from '../ScopeFilter/scope'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { selectTags, tagsForIds, useTags } from '../../stores/tagsStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import {
  focusLiveSession,
  forgetPastSession,
  loadPastSessions,
  openPastSession,
  selectPastSessions,
  selectPastSessionsLoaded,
  usePastSessions
} from '../../stores/pastSessionsStore'
import {
  filterPastByName,
  filterPastByScope,
  folderBasename,
  isAlreadyOpenError,
  pastSessionErrorMessage,
  pastSessionsCapNote,
  pastSessionsEmptyCopy,
  relativeEnded,
  type PastScope
} from './pastSessionsView'
import styles from './PastSessionsDialog.module.css'

export function PastSessionsPage({
  scope,
  setScope,
  pages,
  now
}: DialogPageProps & { now: () => number }): JSX.Element {
  const dialog = useManageDialogContext()
  const sessions = usePastSessions(selectPastSessions)
  const loaded = usePastSessions(selectPastSessionsLoaded)
  const tags = useTags(selectTags)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  // THIS open's load failed. The store keeps the list it already held, but no empty sentence may
  // stand beside the error line: "No past sessions yet." is exactly what could not be checked.
  const [loadFailed, setLoadFailed] = useState(false)
  // Action feedback (spec 2026-09-29 §2.5): the rail says `Loading…` while the history is in
  // flight and nothing is cached (a reopen refetches silently); Retry bumps the generation to fetch again (the Settings theme-list precedent).
  const [loading, setLoading] = useState(true)
  const [loadGeneration, setLoadGeneration] = useState(0)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // An Effect Event, so the mount effect below never re-runs: `dialog.actions` changes identity
  // whenever App re-renders (its `onClose` is an inline arrow), and a re-run would reload the list
  // and pull focus back to the search box.
  const reportLoadFailed = useEffectEvent((): void => {
    setLoadFailed(true)
    dialog.actions.setError('Could not load past sessions')
  })

  // Always fresh: the history changes with every exit, and this is the one place it is read. An
  // aria-modal dialog must also take focus on mount (TemplateList precedent). `alive` drops a load
  // that resolves after the dialog closed (the Settings token-read precedent).
  useEffect(() => {
    let alive = true
    void loadPastSessions().then((ok) => {
      if (!alive) return
      setLoading(false)
      if (!ok) reportLoadFailed()
    })
    return () => {
      alive = false
    }
  }, [loadGeneration])

  // Focus once, on mount — a Retry must not pull focus back to the search box.
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  function retryLoad(): void {
    setLoadFailed(false)
    setLoading(true)
    dialog.actions.setError(null)
    setLoadGeneration((g) => g + 1)
  }

  // Past offers no Global or `(no workspace)`: every record has a workspace. The dialog already
  // resets those on the way in (scopeOnPage); the narrowing keeps the type honest.
  const pastScope: PastScope = scope === 'global' || scope === 'orphans' ? 'all' : scope
  const scoped = filterPastByScope(sessions, pastScope)
  const listed = filterPastByName(scoped, query)
  const selected = sessions.find((s) => s.id === dialog.state.selectedId) ?? null

  function changeScope(next: ScopeFilterValue): void {
    // Never offered here (showGlobal / showOrphans are off); the narrowing keeps the type honest.
    if (next === 'global' || next === 'orphans') return
    setScope(next)
    dialog.actions.select(null) // design.md — changing the scope closes whatever was open
  }

  /** `Open` — D-12: resume in the app and take the view. A refusal stays in the dialog — except
   *  `already_open` for a card the renderer knows, which takes the view to that live card. */
  async function resume(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (selected === null || busy) return
    setBusy(true)
    try {
      await openPastSession(selected.id)
      dialog.actions.close()
    } catch (err) {
      // Spec Open step 3: the session is already live, so go to it rather than report it.
      if (isAlreadyOpenError(err) && (await focusLiveSession(selected.id))) {
        dialog.actions.close()
        return
      }
      dialog.actions.setError(pastSessionErrorMessage(err))
      setBusy(false)
    }
  }

  /** The second press of `Forget` — ManageDialog.Delete owns the first (arm). */
  async function confirmForget(): Promise<void> {
    if (selected === null) return
    setBusy(true)
    try {
      await forgetPastSession(selected.id)
      dialog.actions.select(null)
      dialog.actions.showSuccess('Session forgotten.')
    } catch {
      dialog.actions.setError('Could not forget the session')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ManageDialog.Header>
        <ScopeFilter
          value={pastScope}
          workspaces={workspaces}
          showGlobal={false}
          showOrphans={false}
          onChange={changeScope}
          allLabel="All sessions"
          testId="past-session-scope-filter"
          ariaLabel="Filter past sessions by workspace"
        />
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.List size="wide">
          <TextInput
            inputRef={searchRef}
            variant="inline"
            testId="past-session-search"
            ariaLabel="Search past sessions"
            placeholder="Search"
            value={query}
            onChange={setQuery}
          />
          <ManageDialog.Rows>
            {listed.map((s) => (
              <ManageDialog.Row
                key={s.id}
                id={s.id}
                testId="past-session-row"
                selectTestId={`past-session-select-${s.id}`}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowName} data-testid="past-session-name" title={s.name}>
                    {s.name}
                  </span>
                  <span className={styles.rowMeta}>
                    <span data-testid="past-session-folder">{folderBasename(s.cwd)}</span>
                    {' · '}
                    <span data-testid="past-session-ended">{relativeEnded(s.endedAt, now())}</span>
                  </span>
                  <TagChipRow
                    tags={tagsForIds(tags, s.tagIds)}
                    testId={`past-session-tags-${s.id}`}
                  />
                </span>
              </ManageDialog.Row>
            ))}
            {/* Nothing is said until the list has loaded: the first open of a run would otherwise
                  claim "No past sessions yet." while the history is still in flight. A failed load
                  says so on the error line instead. */}
            {loading && !loadFailed && sessions.length === 0 && (
              <p className={styles.empty} data-testid="past-sessions-loading">
                Loading…
              </p>
            )}
            {loaded && !loading && !loadFailed && listed.length === 0 && (
              <p className={styles.empty} data-testid="past-sessions-empty">
                {pastSessionsEmptyCopy(sessions.length, scoped.length, query)}
              </p>
            )}
          </ManageDialog.Rows>
          {/* The rail's foot, behind a divider (a different region from the list): Retry after a
              failed load, and the cap footnote. */}
          <ManageDialog.ListBottomDivided>
            {loadFailed && (
              <ManageDialog.GhostButton testId="past-sessions-retry" onClick={retryLoad}>
                Retry
              </ManageDialog.GhostButton>
            )}
            <ManageDialog.ListNote testId="past-sessions-cap-note">
              {pastSessionsCapNote(PAST_SESSIONS_MAX)}
            </ManageDialog.ListNote>
          </ManageDialog.ListBottomDivided>
        </ManageDialog.List>
        {selected !== null ? (
          <ManageDialog.Form testId="past-session-form" onSubmit={(e) => void resume(e)}>
            <PastSessionDetails session={selected} workspaces={workspaces} />
            <ManageDialog.Footer>
              <ManageDialog.Delete
                testId="past-session-forget"
                label="Forget"
                confirmLabel="Confirm forget"
                disabled={busy}
                onConfirm={() => void confirmForget()}
              />
              <ManageDialog.Save testId="past-session-open" disabled={busy}>
                Open
              </ManageDialog.Save>
            </ManageDialog.Footer>
          </ManageDialog.Form>
        ) : (
          <ManageDialog.Placeholder testId="past-session-placeholder">
            Select a session on the left.
          </ManageDialog.Placeholder>
        )}
      </ManageDialog.Columns>
      <ManageDialog.Message testId="past-session-error" />
    </>
  )
}

/** The read-only form: name, full folder, workspace (its name in its tint, WorkspaceLabel), tags, times.
 *  No editable field — name and tags change on the live card after Open. */
function PastSessionDetails({
  session,
  workspaces
}: {
  session: PastSession
  workspaces: Workspace[]
}): JSX.Element {
  const tags = useTags(selectTags)
  const shownTags = tagsForIds(tags, session.tagIds)
  const workspace = workspaces.find((w) => w.id === session.workspaceId) ?? null
  return (
    <>
      <ManageDialog.Label>Name</ManageDialog.Label>
      <p className={styles.value} data-testid="past-session-form-name" title={session.name}>
        {session.name}
      </p>
      <ManageDialog.Label>Folder</ManageDialog.Label>
      <p
        className={`${styles.value} ${styles.mono}`}
        data-testid="past-session-form-folder"
        title={session.cwd}
      >
        {session.cwd}
      </p>
      <ManageDialog.Label>Workspace</ManageDialog.Label>
      <p className={styles.valueRow} data-testid="past-session-form-workspace">
        <WorkspaceLabel
          name={workspace?.name ?? '(no workspace)'}
          tone={workspace?.color ?? 'orphan'}
        />
      </p>
      <ManageDialog.Label>Tags</ManageDialog.Label>
      <div className={styles.valueRow}>
        {shownTags.length > 0 ? (
          <TagChipRow tags={shownTags} testId="past-session-form-tags" />
        ) : (
          <span className={styles.none} data-testid="past-session-form-no-tags">
            No tags
          </span>
        )}
      </div>
      <ManageDialog.Label>Launched</ManageDialog.Label>
      <p className={styles.value}>{new Date(session.launchedAt).toLocaleString()}</p>
      <ManageDialog.Label>Ended</ManageDialog.Label>
      <p className={styles.value}>{new Date(session.endedAt).toLocaleString()}</p>
    </>
  )
}
