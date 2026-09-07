// Phrase shortcuts — the list row (read-only) and the editor card.
//
// They are two components on purpose. The editor used to BE a row: four controls (name, chord
// recorder, phrase, three buttons) crammed into the same grid the list uses. The phrase input
// collapsed to a couple of words and a 3-chord sequence overflowed its column. The editor now owns
// a card of its own with labelled fields, so each control gets the width it needs.
import { useState, type JSX } from 'react'
import type { Shortcut } from '../../../../shared/ipc/contract'
import { KeyChordRecorder } from './KeyChordRecorder'
import { ChordKeys } from './ChordKeys'
import { draftToSaveRequest, isDraftDirty, type ShortcutDraft } from './shortcutForm'
import styles from './ShortcutsDialog.module.css'

export interface ShortcutRowProps {
  shortcut: Shortcut
  onEdit: () => void
}

export function ShortcutRow({ shortcut, onEdit }: ShortcutRowProps): JSX.Element {
  return (
    <div className={styles.row} role="row" data-testid={`shortcut-row-${shortcut.id}`}>
      <span className={styles.cellName}>{shortcut.name}</span>
      <ChordKeys keys={shortcut.keys} />
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

export interface ShortcutEditorProps {
  /** null while the card is a brand-new draft. */
  shortcut: Shortcut | null
  draft: ShortcutDraft
  onDraftChange: (draft: ShortcutDraft) => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}

export function ShortcutEditor({
  shortcut,
  draft,
  onDraftChange,
  onCancel,
  onSave,
  onDelete
}: ShortcutEditorProps): JSX.Element {
  // Two-step delete mirrors TemplateForm's affordance (first click arms, second confirms; blur
  // disarms).
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const valid = draftToSaveRequest(draft).ok
  const dirty = isDraftDirty(draft, shortcut)

  return (
    <div className={styles.editor} data-testid="shortcut-row-editing">
      <span className={styles.editorTitle}>
        {shortcut === null ? 'New shortcut' : 'Edit shortcut'}
      </span>

      <div className={styles.editorTop}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="shortcut-name">
            Name
          </label>
          <input
            id="shortcut-name"
            className={styles.input}
            data-testid="shortcut-name-input"
            placeholder="approve"
            value={draft.name}
            onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Keybinding</span>
          <KeyChordRecorder
            value={draft.keys}
            onChange={(keys) => onDraftChange({ ...draft, keys })}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="shortcut-text">
          Phrase
        </label>
        <input
          id="shortcut-text"
          className={styles.input}
          data-testid="shortcut-text-input"
          placeholder="I explicitly approve this plan"
          value={draft.text}
          onChange={(e) => onDraftChange({ ...draft, text: e.target.value })}
        />
        <span className={styles.fieldHelp}>
          Typed into the session as if you had typed it. Nothing is sent until you press Enter.
        </span>
      </div>

      <div className={styles.editorActions}>
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
        <div className={styles.editorActionsRight}>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="shortcut-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            data-testid="shortcut-save"
            disabled={!valid || !dirty}
            onClick={onSave}
          >
            Save shortcut
          </button>
        </div>
      </div>
    </div>
  )
}
