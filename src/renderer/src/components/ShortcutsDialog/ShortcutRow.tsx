// Phrase shortcuts — one table row. Display mode shows the three columns + Edit; edit mode swaps
// in the inputs, the chord recorder and Save/Cancel/Delete. Two-step delete mirrors TemplateForm's
// affordance (first click arms, second confirms; blur disarms).
import { useState, type JSX } from 'react'
import type { Shortcut } from '../../../../shared/ipc/contract'
import { KeyChordRecorder } from './KeyChordRecorder'
import { draftToSaveRequest, isDraftDirty, type ShortcutDraft } from './shortcutForm'
import styles from './ShortcutsDialog.module.css'

export interface ShortcutRowProps {
  /** null while the row is a brand-new draft. */
  shortcut: Shortcut | null
  editing: boolean
  draft: ShortcutDraft
  onDraftChange: (draft: ShortcutDraft) => void
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}

export function ShortcutRow({
  shortcut,
  editing,
  draft,
  onDraftChange,
  onEdit,
  onCancel,
  onSave,
  onDelete
}: ShortcutRowProps): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (!editing && shortcut !== null) {
    return (
      <div className={styles.row} role="row" data-testid={`shortcut-row-${shortcut.id}`}>
        <span className={styles.cellName}>{shortcut.name}</span>
        <span className={styles.cellKeys}>{shortcut.keys}</span>
        <span className={styles.cellText}>{shortcut.text}</span>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid={`shortcut-edit-${shortcut.id}`}
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
    )
  }

  const valid = draftToSaveRequest(draft).ok
  const dirty = isDraftDirty(draft, shortcut)

  return (
    <div className={styles.rowEditing} role="row" data-testid="shortcut-row-editing">
      <input
        className={styles.input}
        data-testid="shortcut-name-input"
        aria-label="Shortcut name"
        value={draft.name}
        onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
      />
      <KeyChordRecorder value={draft.keys} onChange={(keys) => onDraftChange({ ...draft, keys })} />
      <input
        className={styles.input}
        data-testid="shortcut-text-input"
        aria-label="Phrase to type"
        value={draft.text}
        onChange={(e) => onDraftChange({ ...draft, text: e.target.value })}
      />
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.primaryButton}
          data-testid="shortcut-save"
          disabled={!valid || !dirty}
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid="shortcut-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        {shortcut !== null && (
          <button
            type="button"
            className={confirmingDelete ? styles.dangerButton : styles.ghostButton}
            data-testid="shortcut-delete"
            onClick={() => {
              if (confirmingDelete) onDelete()
              else setConfirmingDelete(true)
            }}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? 'Confirm delete' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  )
}
