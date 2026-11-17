// Past sessions (D-6) — the Past PAGE of the Sessions dialog (spec 2026-10-03 E), on
// ManageDialog: a header scope filter (`All sessions` · each workspace — no Global, no orphans:
// every record has a workspace and the delete cascade keeps it so), a search box over the NAME
// with the rail's `Filter` beside it (tag, folder, launched, ended; RailFilter, spec 2026-10-16),
// a FLAT list newest first, a form (tags editable, the rest read-only), and a [Forget] [Open] footer. Importing a session
// the app did not launch is the dialog's Import page. No `+ New` (there is nothing to create) and
// no RowActions. Opened on a record (an episode's `Past sessions`, memory phase 2: the store's
// `pastSessionTarget`), the page selects it once it is listed, on its own workspace, and consumes
// the target. UX-DR14: App.tsx guards it against the other modals and closes it on the quit guard.
// Never logs a record value.
import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { PastSession, Tag, Workspace } from '../../../../shared/ipc/contract'
import { PAST_SESSIONS_MAX } from '../../../../shared/schemas/pastSession'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Callout } from '../Callout/Callout'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import { workspaceScope, type ScopeFilterValue } from '../ScopeFilter/scope'
import { Button } from '../Button/Button'
import { Presence } from '../Presence/Presence'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import { TagPicker } from '../TagPicker/TagPicker'
import { SearchIcon } from '../Icon/MenuIcons'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { folderName } from '../../lib/filterCopy'
import { effectiveFilters, type FilterType, type SessionFilters } from '../../lib/sessionFilters'
import { RailFilter } from '../SessionsDialog/RailFilter'
import { railTags, type ScopedFilters } from '../SessionsDialog/railFilters'
import { boardStore, selectPastSessionTarget, useBoard } from '../../stores/boardStore'
import {
  applyPendingTags,
  selectTags,
  setSessionTags,
  tagsForIds,
  tagsStore,
  useTags
} from '../../stores/tagsStore'
import { keepVisibleTags, visibleTags } from '../../../../shared/tags/tagScope'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import {
  focusLiveSession,
  forgetPastSession,
  loadPastSessions,
  openPastSession,
  selectPastSessions,
  selectPastSessionsLoaded,
  setPastSessionTags,
  pastSessionsStore,
  usePastSessions
} from '../../stores/pastSessionsStore'
import {
  filterPastByFilters,
  filterPastByName,
  filterPastByScope,
  isAlreadyOpenError,
  pastMemoryLine,
  pastSessionErrorMessage,
  pastSessionTagsErrorMessage,
  pastSessionsCapNote,
  pastSessionsEmptyCopy,
  relativeEnded,
  type PastScope
} from './pastSessionsView'
import styles from './PastSessionsDialog.module.css'

/** The types the Past page offers, in pill order: the board's, plus Ended. */
const PAST_TYPES: readonly FilterType[] = ['tag', 'folder', 'launched', 'ended']

export function PastSessionsPage({
  scope,
  setScope,
  pages,
  filters: memory,
  now
}: DialogPageProps & { filters: ScopedFilters; now: () => number }): JSX.Element {
  const dialog = useManageDialogContext()
  const sessions = usePastSessions(selectPastSessions)
  const loaded = usePastSessions(selectPastSessionsLoaded)
  const tags = useTags(selectTags)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  // THIS open's load failed. The store keeps the list it already held, but no empty sentence may
  // stand beside the notice: "No past sessions yet." is exactly what could not be checked. A
  // standing notice, not an action result, so it lives here and never on the dialog's error state
  // (spec 2026-10-26).
  const [loadFailed, setLoadFailed] = useState(false)
  // Action feedback (spec 2026-09-29 §2.5): the rail says `Loading…` while the history is in
  // flight and nothing is cached (a reopen refetches silently); Retry bumps the generation to fetch again (the Settings theme-list precedent).
  const [loading, setLoading] = useState(true)
  const [loadGeneration, setLoadGeneration] = useState(0)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Always fresh: the history changes with every exit, and this is the one place it is read. An
  // aria-modal dialog must also take focus on mount (TemplateList precedent). `alive` drops a load
  // that resolves after the dialog closed (the Settings token-read precedent).
  useEffect(() => {
    let alive = true
    void loadPastSessions().then((ok) => {
      if (!alive) return
      setLoading(false)
      if (!ok) setLoadFailed(true)
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
    setLoadGeneration((g) => g + 1)
  }

  // Past offers no Global or `(no workspace)`: every record has a workspace. The dialog already
  // resets those on the way in (scopeOnPage); the narrowing keeps the type honest.
  const pastScope: PastScope = scope === 'global' || scope === 'orphans' ? 'all' : scope
  // The rail's filters (spec 2026-10-16), per scope while the dialog is open (the dialog holds
  // them); a tag this scope cannot see drops out at read time.
  const filters = memory.read('past', pastScope)
  const setFilters = (next: SessionFilters): void => memory.write('past', pastScope, next)
  const offeredTags = railTags(tags, pastScope)
  const shown = effectiveFilters(filters, new Set(offeredTags.map((t) => t.id)))
  const scoped = filterPastByScope(sessions, pastScope)
  const listed = filterPastByFilters(filterPastByName(scoped, query), shown, now())
  const folders = [...new Set(scoped.map((s) => s.cwd))]
  const selected = sessions.find((s) => s.id === dialog.state.selectedId) ?? null

  // The record this open started on: selected when the history lists it, with the scope on its
  // workspace so the rail shows the row (the dialog's scope, never the board's workspace). The
  // target is consumed here, so a page switch that remounts this page keeps what the operator
  // chose since. `select` is the shell's stable action.
  const target = useBoard(selectPastSessionTarget)
  const targetRecord = sessions.find((s) => s.id === target) ?? null
  const { select } = dialog.actions
  useEffect(() => {
    if (targetRecord === null) return
    boardStore.getState().clearPastSessionTarget()
    setScope(workspaceScope(targetRecord.workspaceId))
    select(targetRecord.id)
  }, [targetRecord, setScope, select])

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
          <RailFilter
            search={
              <TextInput
                inputRef={searchRef}
                variant="toolbar"
                icon={<SearchIcon />}
                testId="past-session-search"
                ariaLabel="Search past sessions"
                placeholder="Search"
                value={query}
                onChange={setQuery}
              />
            }
            filters={shown}
            onChange={setFilters}
            types={PAST_TYPES}
            tags={offeredTags}
            folders={folders}
            now={now}
            testIdPrefix="past-filter"
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
                    <span data-testid="past-session-folder">{folderName(s.cwd)}</span>
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
                  says so here instead, in a danger Callout where that sentence would be. */}
            {loading && !loadFailed && sessions.length === 0 && (
              <p className={styles.empty} data-testid="past-sessions-loading">
                Loading…
              </p>
            )}
            {loaded && !loading && !loadFailed && listed.length === 0 && (
              <p className={styles.empty} data-testid="past-sessions-empty">
                {pastSessionsEmptyCopy(sessions.length, scoped.length)}
              </p>
            )}
            {loadFailed && (
              <Callout
                tone="danger"
                title="Could not load past sessions"
                testId="past-session-load-error"
              />
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
            {/* Keyed by record: nothing one record read (its episode) is shown for another. */}
            <PastSessionDetails
              key={selected.id}
              session={selected}
              workspaces={workspaces}
              setError={dialog.actions.setError}
            />
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
    </>
  )
}

type Episode = { id: string; title: string; body: string }

/** The episode this record's save wrote (memory phase 2), read from memory by id while the record
 *  is shown. null while it loads, when there is none, when the item is gone or not an episode, and
 *  when the read fails: the form then shows the `Memory:` line only, and nothing is toasted (the
 *  record is still whole). A failed read logs its code only, never the id or the text. The form is
 *  keyed by record, so this state starts empty for each record. Within one record the episode id
 *  can change while it is shown (a later save of the same session): a read for the old id is
 *  dropped (`live`), and what was read is shown only while it is still this record's id. */
function useEpisode(episodeId: string | null): Episode | null {
  const [episode, setEpisode] = useState<Episode | null>(null)
  useEffect(() => {
    if (episodeId === null) return
    let live = true
    window.memory
      .get(episodeId)
      .then(({ item }) => {
        if (live && item.kind === 'episode')
          setEpisode({ id: item.id, title: item.title, body: item.body })
      })
      .catch(() => {
        console.warn('[claude-watcher][memory] code=past_episode_read_failed')
      })
    return () => {
      live = false
    }
  }, [episodeId])
  return episode !== null && episode.id === episodeId ? episode : null
}

/** The record's form: name, full folder, workspace (its name in its tint, WorkspaceLabel), tags,
 *  times, then what memory kept from the session (PICK.md look 2: the `Memory:` line as a label,
 *  the episode's title as a value and its body as a wrapping paragraph; no colour for any state).
 *  Tags are the one editable field: the Memory form's tag button and picker, writing through
 *  `setSessionTags` to `window.pastSessions.setTags` (a refusal is the dialog's result toast).
 *  The name changes on the live card after Open. */
function PastSessionDetails({
  session,
  workspaces,
  setError
}: {
  session: PastSession
  workspaces: Workspace[]
  setError: (message: string) => void
}): JSX.Element {
  const tags = useTags(selectTags)
  const pending = useTags((s) => s.pendingBySession.get(session.id))
  const shownTags = tagsForIds(tags, applyPendingTags(session.tagIds, pending))
  const offeredTags = visibleTags(tags, session.workspaceId)
  const tagPickerId = useId()
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsAnchorRef = useRef<HTMLDivElement | null>(null)
  const tagsButtonRef = useRef<HTMLButtonElement | null>(null)

  function closeTags(reason: 'escape' | 'outside'): void {
    setTagsOpen(false)
    // Only Escape hands focus back; an outside click leaves focus where the operator clicked.
    if (reason === 'escape') tagsButtonRef.current?.focus()
  }

  /** The record's tags as main holds them now, without an id the catalog lost or its workspace
   *  cannot see: a stale id is never sent (main would refuse it `tag_not_found`). */
  function readRecordTags(): string[] {
    const record = pastSessionsStore.getState().sessions.find((s) => s.id === session.id)
    if (record === undefined) return []
    const lookup = (id: string): Tag | null =>
      tagsStore.getState().tags.find((t) => t.id === id) ?? null
    return keepVisibleTags(record.tagIds, record.workspaceId, lookup)
  }

  const workspace = workspaces.find((w) => w.id === session.workspaceId) ?? null
  const memoryLine = pastMemoryLine(session.memory)
  const episode = useEpisode(session.memory?.episodeId ?? null)
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
      <div className={styles.valueRow} ref={tagsAnchorRef} data-testid="past-session-tags-field">
        {shownTags.length > 0 ? (
          <TagChipRow tags={shownTags} testId="past-session-form-tags" />
        ) : (
          <span className={styles.none} data-testid="past-session-form-no-tags">
            No tags
          </span>
        )}
        <Button
          variant="ghost"
          size="xs"
          icon
          buttonRef={tagsButtonRef}
          testId="past-session-tags-button"
          aria-expanded={tagsOpen}
          aria-controls={tagPickerId}
          aria-label="Tags"
          title="Tags"
          onClick={() => setTagsOpen((open) => !open)}
        >
          <TagGlyphIcon />
        </Button>
        <Presence value={tagsOpen || null}>
          {() => (
            <TagPicker
              id={tagPickerId}
              tags={offeredTags}
              selectedIds={session.tagIds}
              sessionId={session.id}
              onChange={(next) =>
                void setSessionTags(session.id, next, readRecordTags, {
                  write: setPastSessionTags,
                  onError: (err) => setError(pastSessionTagsErrorMessage(err))
                })
              }
              onClose={closeTags}
              anchorRef={tagsAnchorRef}
              triggerRef={tagsButtonRef}
              testId="past-session-tag-picker"
              label="Tags"
            />
          )}
        </Presence>
      </div>
      <ManageDialog.Label>Launched</ManageDialog.Label>
      <p className={styles.value}>{new Date(session.launchedAt).toLocaleString()}</p>
      <ManageDialog.Label>Ended</ManageDialog.Label>
      <p className={styles.value}>{new Date(session.endedAt).toLocaleString()}</p>
      {memoryLine !== null && <ManageDialog.Label>{memoryLine}</ManageDialog.Label>}
      {memoryLine !== null && episode !== null && (
        <>
          <p
            className={styles.value}
            data-testid="past-session-form-episode-title"
            title={episode.title}
          >
            {episode.title}
          </p>
          <p className={styles.episodeBody} data-testid="past-session-form-episode-body">
            {episode.body}
          </p>
        </>
      )}
    </>
  )
}
