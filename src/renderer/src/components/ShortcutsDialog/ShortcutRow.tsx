// Phrase shortcuts — the list row (read-only) and the editor card.
//
// They are two components on purpose. The editor used to BE a row: four controls (name, chord
// recorder, phrase, three buttons) crammed into the same grid the list uses. The phrase input
// collapsed to a couple of words and a 3-chord sequence overflowed its column. The editor now owns
// a card of its own with labelled fields, so each control gets the width it needs. The editor's
// second control is now an Alias field (TextInput), not a chord recorder — the ONE open chord
// lives in settings and is recorded once, in the dialog header (see ShortcutsDialog.tsx).
//
// Its buttons are the shared ManageDialog ones: the arm-in-place Delete (blur and Escape disarm),
// the ghost Cancel/Edit and the primary Save. Rendered inside ShortcutsDialog's ManageDialog.Provider.
import type { JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Shortcut } from '../../../../shared/ipc/contract'
import { SHORTCUT_ALIAS_MAX_LENGTH } from '../../../../shared/schemas/shortcut'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import {
  draftToSaveRequest,
  isDraftDirty,
  shortcutDraftProblem,
  type ShortcutDraft
} from './shortcutForm'
import { Select } from '../Select/Select'
import { WorkspaceDot } from '../WorkspaceDot/WorkspaceDot'
import { TextInput } from '../TextInput/TextInput'
import styles from './ShortcutsDialog.module.css'

/** The `Workspace` dropdown's stand-in for "no workspace" — a word, not '', because it becomes
 *  part of the option's testid. Cannot collide with a workspace id. */
const GLOBAL_SCOPE = 'global'

export interface ShortcutRowProps {
  shortcut: Shortcut
  onEdit: () => void
}

export function ShortcutRow({ shortcut, onEdit }: ShortcutRowProps): JSX.Element {
  return (
    <div className={styles.row} role="row" data-testid={`shortcut-row-${shortcut.id}`}>
      <span className={styles.cellName}>{shortcut.name}</span>
      <span className={styles.cellAlias} data-testid={`shortcut-alias-${shortcut.id}`}>
        {shortcut.alias}
      </span>
      <span className={styles.cellText}>{shortcut.text}</span>
      <ManageDialog.GhostButton testId={`shortcut-edit-${shortcut.id}`} onClick={onEdit}>
        Edit
      </ManageDialog.GhostButton>
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
  // Workspaces (Task 11) — the scope select's options. useShallow: selectWorkspaces returns array.
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const { state } = useManageDialogContext()
  const valid = draftToSaveRequest(draft).ok
  const dirty = isDraftDirty(draft, shortcut)
  // R26 — why Save is greyed, once the operator has edited something. A muted hint, NOT the
  // role=alert error line (reserved for main's refusals) — TemplateForm's precedent.
  const problem = dirty && !valid && state.error === null ? shortcutDraftProblem(draft) : null

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
          <TextInput
            id="shortcut-name"
            testId="shortcut-name-input"
            placeholder="approve"
            value={draft.name}
            onChange={(name) => onDraftChange({ ...draft, name })}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="shortcut-alias">
            Alias
          </label>
          <TextInput
            id="shortcut-alias"
            testId="shortcut-alias-input"
            placeholder="ht"
            maxLength={SHORTCUT_ALIAS_MAX_LENGTH}
            value={draft.alias}
            onChange={(alias) => onDraftChange({ ...draft, alias })}
          />
          <span className={styles.fieldHelp}>The word you type first in the box.</span>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="shortcut-text">
          Phrase
        </label>
        <TextInput
          id="shortcut-text"
          testId="shortcut-text-input"
          placeholder="I explicitly approve this plan"
          value={draft.text}
          onChange={(text) => onDraftChange({ ...draft, text })}
        />
        <span className={styles.fieldHelp}>
          Typed into the session, never sent. <code>$1</code>, <code>$2</code>… take the values in
          order, <code>$*</code> takes the rest, <code>$$</code> is a literal $.
        </span>
      </div>

      <div className={styles.field}>
        {/* A <span>, not a <label htmlFor>: the control is a button-and-listbox, which `for`
            cannot address — `ariaLabel` carries the name to assistive tech instead. */}
        <span className={styles.fieldLabel}>Workspace</span>
        {/* `'global'` ⇄ null. A WORD, not '': the sentinel ends up in the option's testid. A
            workspace id can never collide with it (uuids, or the literal `default`). A NEW row
            defaults to Global (emptyDraft), never the active workspace: the non-surprising
            default, matching every shortcut that predates scoping. */}
        <Select
          value={draft.workspaceId ?? GLOBAL_SCOPE}
          options={[
            { value: GLOBAL_SCOPE, label: 'Global', adornment: <WorkspaceDot tone="global" /> },
            ...workspaces.map((w) => ({
              value: w.id,
              label: w.name,
              adornment: <WorkspaceDot tone={w.color} />
            }))
          ]}
          onChange={(next) =>
            onDraftChange({ ...draft, workspaceId: next === GLOBAL_SCOPE ? null : next })
          }
          ariaLabel="Workspace"
          testId="shortcut-scope"
        />
      </div>

      {problem !== null && <ManageDialog.Hint testId="shortcut-hint">{problem}</ManageDialog.Hint>}

      <div className={styles.editorActions}>
        {shortcut !== null && <ManageDialog.Delete testId="shortcut-delete" onConfirm={onDelete} />}
        <div className={styles.editorActionsRight}>
          <ManageDialog.GhostButton testId="shortcut-cancel" onClick={onCancel}>
            Cancel
          </ManageDialog.GhostButton>
          <ManageDialog.Save testId="shortcut-save" disabled={!valid || !dirty} onClick={onSave}>
            Save shortcut
          </ManageDialog.Save>
        </div>
      </div>
    </div>
  )
}
