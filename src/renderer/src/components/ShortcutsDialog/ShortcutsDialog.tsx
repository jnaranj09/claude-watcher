// Phrase shortcuts — the Manage dialog (modal, z 60 like TemplatesDialog).
//
// Layout: a header that states what a shortcut DOES, then the editor card (only while adding or
// editing), then the list. The editor is deliberately NOT a row in the list — see ShortcutRow.tsx.
// UX-DR14: App.tsx guards it against the other modals and closes it on the quit guard.
import { Fragment, useState, type JSX, type KeyboardEvent } from 'react'
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
import { groupShortcuts } from './groupShortcuts'
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
  // The Manage dialog shows EVERY shortcut regardless of scope (unlike the terminal matcher) —
  // no makeSelectVisibleShortcuts here. activeWorkspaceId + workspaces feed the grouping below.
  const shortcuts = useShortcuts(selectShortcuts)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  // NEW_ROW = the add-a-shortcut draft; a string id = editing that shortcut; null = nothing open.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ShortcutDraft>(emptyDraft)
  const [error, setError] = useState<ShortcutErrorCode | null>(null)

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
    // void + catch: a rejected save renders a code-mapped message, never the error object
    // (it can carry operator content).
    void saveShortcut(result.req)
      .then(cancel)
      .catch((err: unknown) => setError(shortcutErrorCode(err)))
  }

  function handleDelete(id: string): void {
    void removeShortcut(id).then(cancel)
  }

  // The shortcut under edit, if any. The editor card renders it, so the list hides that row —
  // one thing on screen per shortcut.
  const editingShortcut = shortcuts.find((s) => s.id === editingId) ?? null
  const listed = shortcuts.filter((s) => s.id !== editingId)
  const groups = groupShortcuts(listed, activeWorkspaceId, workspaces)

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
            <h2 className={styles.title}>Shortcuts</h2>
            <p className={styles.subtitle}>
              Press a chord in a session to type its phrase. You press Enter to send.
            </p>
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
              Add one and give it a chord like <ChordKeys keys={['Ctrl+Alt+A']} /> to type its
              phrase in any session.
            </span>
          </div>
        ) : (
          <div className={styles.list} role="table" aria-label="Shortcuts">
            <div className={styles.headRow} role="row">
              <span>Name</span>
              <span>Keybinding</span>
              <span>Phrase</span>
              <span />
            </div>
            {groups.map((g) => (
              <Fragment key={g.id}>
                {/* Workspaces (Task 11) — the label is its OWN role="row" sibling, ABOVE the
                    rowgroup, so it never sits as a bare non-row child of role="table" (a11y). */}
                <div className={styles.groupLabelRow} role="row">
                  <p className={styles.groupLabel}>{g.label}</p>
                </div>
                <div
                  className={styles.group}
                  role="rowgroup"
                  data-testid={g.id === 'orphans' ? 'shortcut-group-orphans' : undefined}
                >
                  {g.shortcuts.map((shortcut) => (
                    <ShortcutRow
                      key={shortcut.id}
                      shortcut={shortcut}
                      onEdit={() => startEdit(shortcut)}
                    />
                  ))}
                </div>
              </Fragment>
            ))}
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
