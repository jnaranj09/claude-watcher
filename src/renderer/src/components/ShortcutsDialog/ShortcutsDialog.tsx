// Phrase shortcuts — the Manage dialog (modal, z 60 like TemplatesDialog).
//
// Layout: a header that states what a shortcut DOES, then the editor card (only while adding or
// editing), then the list. The editor is deliberately NOT a row in the list — see ShortcutRow.tsx.
// UX-DR14: App.tsx guards it against the other modals and closes it on the quit guard.
import { useState, type JSX, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Shortcut } from '../../../../shared/ipc/contract'
import {
  selectShortcuts,
  useShortcuts,
  saveShortcut,
  removeShortcut
} from '../../stores/shortcutsStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ShortcutRow, ShortcutEditor } from './ShortcutRow'
import { ChordKeys } from './ChordKeys'
import { KeyChordRecorder } from './KeyChordRecorder'
import { persistSettingsPatch, selectExpanderKey, useSettings } from '../../stores/settingsStore'
import { expanderChord } from '../../../../shared/schemas/settings'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import {
  ALL_SCOPE,
  filterByScope,
  hasOrphans,
  knownWorkspaceIds,
  scopeOf,
  workspaceScope,
  type ScopeFilterValue
} from '../ScopeFilter/scope'
import {
  emptyDraft,
  toDraft,
  draftToSaveRequest,
  shortcutErrorCode,
  SHORTCUT_ERROR_COPY,
  type ShortcutDraft,
  type ShortcutErrorCode
} from './shortcutForm'
import styles from './ShortcutsDialog.module.css'

export interface ShortcutsDialogProps {
  onClose: () => void
}

/** The sentinel `editingId` for the add-a-shortcut draft (no real id exists yet). */
const NEW_ROW = 'new'

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps): JSX.Element {
  // The Manage dialog can show EVERY shortcut regardless of scope (unlike the terminal matcher) —
  // no makeSelectVisibleShortcuts here. activeWorkspaceId + workspaces feed the header's scope
  // filter, which is the ONE thing that narrows this list.
  const shortcuts = useShortcuts(selectShortcuts)
  const expanderKey = useSettings(selectExpanderKey)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  // NEW_ROW = the add-a-shortcut draft; a string id = editing that shortcut; null = nothing open.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ShortcutDraft>(emptyDraft)
  const [error, setError] = useState<ShortcutErrorCode | null>(null)
  const known = knownWorkspaceIds(workspaces)
  // Opens on the workspace you are working in; the `all` entry if that id names no known
  // workspace, so the select never sits on an option it does not offer. Same rule as
  // TemplatesDialog — the two dialogs must behave identically here.
  const [scope, setScope] = useState<ScopeFilterValue>(() =>
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? workspaceScope(activeWorkspaceId)
      : ALL_SCOPE
  )

  function changeScope(next: ScopeFilterValue): void {
    setScope(next)
    // An editor open on a row from the OLD scope would outlive the list it came from.
    cancel()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  function startAdd(): void {
    setEditingId(NEW_ROW)
    setDraft(emptyDraft())
    setError(null)
  }

  function startEdit(shortcut: Shortcut): void {
    setEditingId(shortcut.id)
    setDraft(toDraft(shortcut))
    setError(null)
  }

  function cancel(): void {
    setEditingId(null)
    setDraft(emptyDraft())
    setError(null)
  }

  function handleSave(): void {
    const result = draftToSaveRequest(draft)
    if (!result.ok) return
    // Changing a row's Workspace can move it out of the view you saved it from, and a row that
    // vanishes on save reads as a failed save — follow it instead. Read off the draft, which is
    // what was just written.
    const saved = scopeOf(draft.workspaceId, known)
    // void + catch: a rejected save renders a code-mapped message, never the error object
    // (it can carry operator content).
    void saveShortcut(result.req)
      .then(() => {
        cancel()
        if (scope !== ALL_SCOPE && scope !== saved) setScope(saved)
      })
      .catch((err: unknown) => setError(shortcutErrorCode(err)))
  }

  function handleDelete(id: string): void {
    void removeShortcut(id).then(cancel)
  }

  // The shortcut under edit, if any. The editor card renders it, so the list hides that row —
  // one thing on screen per shortcut.
  const editingShortcut = shortcuts.find((s) => s.id === editingId) ?? null
  const listed = filterByScope(
    shortcuts.filter((s) => s.id !== editingId),
    scope,
    known
  )

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Shortcuts"
      data-testid="shortcuts-overlay"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.panel} data-testid="shortcuts-panel">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.titleRow}>
              <h2 className={styles.title}>Shortcuts</h2>
              <ScopeFilter
                value={scope}
                workspaces={workspaces}
                showOrphans={hasOrphans(shortcuts, known)}
                onChange={changeScope}
                allLabel="All shortcuts"
                testId="shortcut-scope-filter"
                ariaLabel="Filter shortcuts by workspace"
              />
            </div>
            <p className={styles.subtitle} data-testid="shortcuts-subtitle">
              Press <ChordKeys keys={[expanderChord(expanderKey)]} />, type an alias and its values,
              then Enter to type the result. You press Enter to send.
            </p>
            <div className={styles.openWith}>
              <span className={styles.fieldLabel}>Open with</span>
              <KeyChordRecorder
                value={expanderChord(expanderKey)}
                onChange={(chord) => {
                  // The chord is `Ctrl+Alt+<letter>`; the letter is the last character.
                  void persistSettingsPatch({ expanderKey: chord.slice(-1) })
                }}
              />
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.ghostButton}
              data-testid="shortcuts-add"
              onClick={startAdd}
              disabled={editingId === NEW_ROW}
            >
              Add shortcut
            </button>
            <button
              type="button"
              className={styles.closeButton}
              data-testid="shortcuts-close"
              aria-label="Close shortcuts"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {editingId !== null && (
          <ShortcutEditor
            shortcut={editingShortcut}
            draft={draft}
            onDraftChange={setDraft}
            onCancel={cancel}
            onSave={handleSave}
            onDelete={() => {
              if (editingShortcut !== null) handleDelete(editingShortcut.id)
            }}
          />
        )}

        {shortcuts.length === 0 ? (
          <div className={styles.empty} data-testid="shortcuts-empty">
            <span className={styles.emptyTitle}>No shortcuts yet</span>
            <span className={styles.emptyBody}>
              Add one and give it an alias like <code>ht</code> to type its phrase in any session.
            </span>
          </div>
        ) : (
          <div className={styles.list} role="table" aria-label="Shortcuts">
            <div className={styles.headRow} role="row">
              <span>Name</span>
              <span>Alias</span>
              <span>Phrase</span>
              <span />
            </div>
            {/* ONE flat rowgroup — no scope sections. Which workspace a row belongs to is the
                editor's Workspace field; a section header repeated it and cost the list a third
                of its height. Still a rowgroup so the a11y tree stays table > rowgroup > row. */}
            <div className={styles.group} role="rowgroup">
              {listed.map((shortcut) => (
                <ShortcutRow
                  key={shortcut.id}
                  shortcut={shortcut}
                  onEdit={() => startEdit(shortcut)}
                />
              ))}
            </div>
          </div>
        )}

        {error !== null && (
          <span className={styles.error} data-testid="shortcuts-error" role="alert">
            {SHORTCUT_ERROR_COPY[error]}
          </span>
        )}
      </div>
    </div>
  )
}
