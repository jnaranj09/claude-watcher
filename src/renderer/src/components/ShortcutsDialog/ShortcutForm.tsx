// Phrase shortcuts — the right column's form (spec 2026-09-29 §4). It replaced the editor card
// that sat above a table: every sibling Manage dialog is `rail | form`, and Shortcuts was the one
// exception. Keyed by the row it edits (`key={id ?? 'new'}`), so it owns its draft and a row
// switch starts clean — no Cancel: picking another row or closing drops the draft, as in the
// sibling dialogs.
import { useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Shortcut } from '../../../../shared/ipc/contract'
import { SHORTCUT_ALIAS_MAX_LENGTH } from '../../../../shared/schemas/shortcut'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { saveShortcut, removeShortcut } from '../../stores/shortcutsStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import {
  emptyDraft,
  toDraft,
  draftToSaveRequest,
  isDraftDirty,
  shortcutDraftProblem,
  shortcutErrorCode,
  SHORTCUT_DELETE_ERROR_COPY,
  SHORTCUT_ERROR_COPY,
  type ShortcutDraft
} from './shortcutForm'
import { Select } from '../Select/Select'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { TextInput } from '../TextInput/TextInput'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import styles from './ShortcutsDialog.module.css'

/** The `Workspace` dropdown's stand-in for "no workspace" — a word, not '', because it becomes
 *  part of the option's testid. Cannot collide with a workspace id. */
const GLOBAL_SCOPE = 'global'

export interface ShortcutFormProps {
  /** null for the New form. */
  shortcut: Shortcut | null
  /** After main saved it. The dialog selects the saved row and moves the filter if needed. */
  onSaved: (saved: Shortcut) => void
}

export function ShortcutForm({ shortcut, onSaved }: ShortcutFormProps): JSX.Element {
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const { state, actions } = useManageDialogContext()
  const [draft, setDraft] = useState<ShortcutDraft>(() =>
    shortcut === null ? emptyDraft() : toDraft(shortcut)
  )
  const result = draftToSaveRequest(draft)
  const dirty = isDraftDirty(draft, shortcut)
  // R26 — why Save is greyed, once the operator has edited something. A muted hint, NOT the
  // role=alert error line (reserved for main's refusals).
  const problem = dirty && !result.ok && state.error === null ? shortcutDraftProblem(draft) : null

  // R26 — editing a field clears the error line.
  function change(next: ShortcutDraft): void {
    setDraft(next)
    actions.setError(null)
  }

  // Action feedback (spec 2026-09-29 §2.5) — one save and one delete in flight at a time: a double
  // Enter used to save twice. A refusal renders code-mapped copy, never the error object.
  const save = useAsyncAction(async (req: Parameters<typeof saveShortcut>[0]): Promise<void> => {
    try {
      onSaved(await saveShortcut(req))
    } catch (err) {
      actions.setError(SHORTCUT_ERROR_COPY[shortcutErrorCode(err)])
    }
  })
  // R26 — a refused delete keeps the form open and says so.
  const remove = useAsyncAction(async (): Promise<void> => {
    if (shortcut === null) return
    try {
      await removeShortcut(shortcut.id)
      actions.select(null)
    } catch (err) {
      actions.setError(SHORTCUT_DELETE_ERROR_COPY[shortcutErrorCode(err)])
    }
  })

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    if (!result.ok || !dirty) return
    void save.run(result.req)
  }

  return (
    <ManageDialog.Form testId="shortcut-form" onSubmit={submit}>
      <ManageDialog.Label htmlFor="shortcut-name">Name</ManageDialog.Label>
      <TextInput
        id="shortcut-name"
        testId="shortcut-name-input"
        placeholder="approve"
        value={draft.name}
        onChange={(name) => change({ ...draft, name })}
      />

      <ManageDialog.Label htmlFor="shortcut-alias">Alias</ManageDialog.Label>
      <TextInput
        id="shortcut-alias"
        testId="shortcut-alias-input"
        placeholder="ht"
        maxLength={SHORTCUT_ALIAS_MAX_LENGTH}
        value={draft.alias}
        onChange={(alias) => change({ ...draft, alias })}
      />
      <span className={styles.fieldHelp}>The word you type first in the box.</span>

      <ManageDialog.Label htmlFor="shortcut-text">Phrase</ManageDialog.Label>
      <TextInput
        id="shortcut-text"
        testId="shortcut-text-input"
        placeholder="I explicitly approve this plan"
        value={draft.text}
        onChange={(text) => change({ ...draft, text })}
      />
      <span className={styles.fieldHelp}>
        Typed into the session, never sent. <code>$1</code>, <code>$2</code>… take the values in
        order, <code>$*</code> takes the rest, <code>$$</code> is a literal $.
      </span>

      {/* A <span> label: the Select is a button-and-listbox, which `for` cannot address. */}
      <ManageDialog.Label>Workspace</ManageDialog.Label>
      {/* A NEW row defaults to Global (emptyDraft), never the active workspace. */}
      <Select
        value={draft.workspaceId ?? GLOBAL_SCOPE}
        options={[
          {
            value: GLOBAL_SCOPE,
            label: 'Global',
            display: <WorkspaceLabel name="Global" tone="global" />
          },
          ...workspaces.map((w) => ({
            value: w.id,
            label: w.name,
            display: <WorkspaceLabel name={w.name} tone={w.color} />
          }))
        ]}
        onChange={(next) => change({ ...draft, workspaceId: next === GLOBAL_SCOPE ? null : next })}
        ariaLabel="Workspace"
        testId="shortcut-scope"
      />

      {problem !== null && <ManageDialog.Hint testId="shortcut-hint">{problem}</ManageDialog.Hint>}

      <ManageDialog.Footer>
        {shortcut !== null && (
          <ManageDialog.Delete
            testId="shortcut-delete"
            busy={remove.busy}
            onConfirm={() => void remove.run()}
          />
        )}
        <ManageDialog.Save
          testId="shortcut-save"
          disabled={!result.ok || !dirty}
          busy={save.busy}
        />
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}
