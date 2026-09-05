// Phrase shortcuts — the Manage dialog (modal, z 60 like TemplatesDialog). A single full-width
// table (Name · Keybinding · Phrase) rather than list+form: a shortcut has only three fields.
// UX-DR14: App.tsx guards it against the other modals and closes it on the quit guard.
import { useState, type JSX, type KeyboardEvent } from 'react'
import type { Shortcut } from '../../../../shared/ipc/contract'
import {
  selectShortcuts,
  useShortcuts,
  saveShortcut,
  removeShortcut
} from '../../stores/shortcutsStore'
import { ShortcutRow } from './ShortcutRow'
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

/** The sentinel `editingId` for the add-a-shortcut draft row (no real id exists yet). */
const NEW_ROW = 'new'

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps): JSX.Element {
  const shortcuts = useShortcuts(selectShortcuts)
  // NEW_ROW = the add-a-shortcut draft row; a string id = editing that row; null = nothing open.
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
          <span className={styles.title}>Shortcuts</span>
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
        <div className={styles.addRow}>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="shortcuts-add"
            onClick={startAdd}
          >
            + Add shortcut
          </button>
        </div>
        <div className={styles.table} role="table" aria-label="Shortcuts">
          <div className={styles.headRow} role="row">
            <span>Name</span>
            <span>Keybinding</span>
            <span>Phrase</span>
            <span />
          </div>
          {editingId === NEW_ROW && (
            <ShortcutRow
              shortcut={null}
              editing
              draft={draft}
              onDraftChange={setDraft}
              onEdit={cancel}
              onCancel={cancel}
              onSave={handleSave}
              onDelete={cancel}
            />
          )}
          {shortcuts.map((shortcut) => (
            <ShortcutRow
              key={shortcut.id}
              shortcut={shortcut}
              editing={editingId === shortcut.id}
              draft={editingId === shortcut.id ? draft : toDraft(shortcut)}
              onDraftChange={setDraft}
              onEdit={() => startEdit(shortcut)}
              onCancel={cancel}
              onSave={handleSave}
              onDelete={() => handleDelete(shortcut.id)}
            />
          ))}
          {shortcuts.length === 0 && editingId !== NEW_ROW && (
            <span className={styles.empty} data-testid="shortcuts-empty">
              No shortcuts yet. Add one to type a phrase with Ctrl+Shift+&lt;letter&gt;.
            </span>
          )}
        </div>
        <span className={styles.hint}>
          Shortcuts type the phrase into the focused session — press Enter yourself to send it.
        </span>
        {error !== null && (
          <span className={styles.error} data-testid="shortcuts-error" role="alert">
            {SHORTCUT_ERROR_COPY[error]}
          </span>
        )}
      </div>
    </div>
  )
}
