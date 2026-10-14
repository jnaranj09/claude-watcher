// Phrase shortcuts — the Manage dialog (modal, z 60 like the other Manage dialogs). The
// two-column standard: a rail of shortcuts (name + alias) and the form on the right, the
// placeholder while nothing is open (spec 2026-09-29 §4). The open chord is set in Settings →
// Keyboard; the subtitle shows it. UX-DR14: App.tsx guards it against the other modals.
import { IncludeGlobal } from '../ScopeFilter/IncludeGlobal'
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Shortcut } from '../../../../shared/ipc/contract'
import {
  selectShortcuts,
  selectShortcutsLoadFailed,
  setShortcutFavorite,
  useShortcuts
} from '../../stores/shortcutsStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { ShortcutForm } from './ShortcutForm'
import { FavoriteToggle } from '../FavoriteToggle/FavoriteToggle'
import { favoritesFirst } from '../../lib/favoritesFirst'
import { favoriteErrorCopy } from '../../lib/favoriteCopy'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { ChordKeys } from './ChordKeys'
import { selectExpanderKey, selectIncludeGlobal, useSettings } from '../../stores/settingsStore'
import { expanderChord } from '../../../../shared/schemas/settings'
import { ScopeMarker } from '../ScopeFilter/ScopeMarker'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import {
  ALL_SCOPE,
  filterByScope,
  workspaceRowsFirst,
  hasOrphans,
  knownWorkspaceIds,
  scopeOf,
  workspaceScope,
  type ScopeFilterValue
} from '../ScopeFilter/scope'
import styles from './ShortcutsDialog.module.css'

export interface ShortcutsDialogProps {
  onClose: () => void
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps): JSX.Element {
  // The dialog shows EVERY shortcut regardless of scope (unlike the terminal matcher); the
  // header's scope filter is the ONE thing that narrows the rail.
  const shortcuts = useShortcuts(selectShortcuts)
  const loadFailed = useShortcuts(selectShortcutsLoadFailed)
  const expanderKey = useSettings(selectExpanderKey)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const dialog = useManageDialog({ title: 'Shortcuts', testIdPrefix: 'shortcuts', onClose })
  const known = knownWorkspaceIds(workspaces)
  // Opens on the workspace you are working in — same rule as the Sessions dialog.
  const [scope, setScope] = useState<ScopeFilterValue>(() =>
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? workspaceScope(activeWorkspaceId)
      : ALL_SCOPE
  )
  const selected = shortcuts.find((s) => s.id === dialog.state.selectedId) ?? null
  const formOpen = dialog.state.creating || selected !== null
  const includeGlobal = useSettings(selectIncludeGlobal)
  // Favorites first BEFORE the scope helpers: both keep input order, so the stars lead inside
  // each group (own workspace, then global).
  const listed = workspaceRowsFirst(
    filterByScope(favoritesFirst(shortcuts), scope, known, includeGlobal),
    scope
  )
  // A refused star lands in the dialog's message slot; the star keeps main's state.
  const starring = useAsyncAction(async (s: Shortcut): Promise<void> => {
    dialog.actions.setError(null)
    try {
      await setShortcutFavorite(s.id, !s.favorite)
    } catch (err) {
      dialog.actions.setError(favoriteErrorCopy(err))
    }
  })

  function changeScope(next: ScopeFilterValue): void {
    setScope(next)
    // design.md — changing the scope closes whatever was open.
    dialog.actions.select(null)
  }

  /** design.md — a save that moves a row to another scope follows it. */
  function revealSaved(saved: Shortcut): void {
    dialog.actions.select(saved.id)
    if (filterByScope([saved], scope, known, includeGlobal).length === 0) {
      setScope(scopeOf(saved.workspaceId, known))
    }
    dialog.actions.showSuccess('Shortcut saved.')
  }

  // R7 — three empty states (design.md): none at all, none in this scope; no search box here.
  const emptyCopy =
    shortcuts.length === 0
      ? null
      : scope === 'global'
        ? 'No global shortcuts'
        : scope === 'orphans'
          ? 'No shortcuts without a workspace'
          : 'No shortcuts in this workspace'

  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header
          subtitle={
            <span data-testid="shortcuts-subtitle">
              Press <ChordKeys keys={[expanderChord(expanderKey)]} />, type an alias and its values,
              then Enter to type the result. You press Enter to send.
            </span>
          }
        >
          <ScopeFilter
            value={scope}
            workspaces={workspaces}
            showOrphans={hasOrphans(shortcuts, known)}
            onChange={changeScope}
            allLabel="All shortcuts"
            testId="shortcut-scope-filter"
            ariaLabel="Filter shortcuts by workspace"
          />
          <IncludeGlobal scope={scope} testId="shortcut-include-global" />
        </ManageDialog.Header>
        <ManageDialog.Columns>
          <ManageDialog.List size="wide">
            <ManageDialog.Rows>
              {listed.map((s) => (
                <ManageDialog.Row
                  key={s.id}
                  id={s.id}
                  testId={`shortcut-row-${s.id}`}
                  selectTestId={`shortcut-select-${s.id}`}
                >
                  <ManageDialog.RowFavorite>
                    <FavoriteToggle
                      name={s.name}
                      favorite={s.favorite}
                      busy={starring.busy}
                      onToggle={() => void starring.run(s)}
                      testId={`shortcut-favorite-${s.id}`}
                    />
                  </ManageDialog.RowFavorite>
                  <span className={styles.rowName}>{s.name}</span>
                  <span className={styles.rowAlias} data-testid={`shortcut-alias-${s.id}`}>
                    {s.alias}
                  </span>
                  <ScopeMarker workspaceId={s.workspaceId} workspaces={workspaces} />
                </ManageDialog.Row>
              ))}
              {shortcuts.length === 0 &&
                (loadFailed ? (
                  <p className={styles.empty} data-testid="shortcuts-load-failed">
                    Could not load shortcuts.
                  </p>
                ) : (
                  <p className={styles.empty} data-testid="shortcuts-empty">
                    No shortcuts yet. Add one and give it an alias like <code>ht</code>.
                  </p>
                ))}
              {emptyCopy !== null && listed.length === 0 && (
                <p className={styles.empty} data-testid="shortcuts-empty-scope">
                  {emptyCopy}
                </p>
              )}
            </ManageDialog.Rows>
            <ManageDialog.New testId="shortcut-new" />
          </ManageDialog.List>
          {formOpen ? (
            <ShortcutForm key={selected?.id ?? 'new'} shortcut={selected} onSaved={revealSaved} />
          ) : (
            <ManageDialog.Placeholder testId="shortcut-placeholder">
              Select a shortcut on the left, or create a new one.
            </ManageDialog.Placeholder>
          )}
        </ManageDialog.Columns>
        <ManageDialog.Message testId="shortcuts-error" />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
