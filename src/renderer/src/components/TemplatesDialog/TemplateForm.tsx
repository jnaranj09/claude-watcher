// Session templates — the edit form. Keyed by the selected id in TemplatesDialog, so a
// selection change remounts it with a fresh draft (no effect-based syncing).
import { useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import {
  TEMPLATE_NAME_MAX_LENGTH,
  MODEL_NAME_MAX_LENGTH
} from '../../../../shared/schemas/template'
import { removeTemplate, saveTemplate } from '../../stores/templatesStore'
import { Select } from '../Select/Select'
import { WorkspaceDot } from '../WorkspaceDot/WorkspaceDot'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import {
  MODEL_CHOICES,
  PERMISSION_CHOICES,
  EFFORT_CHOICES,
  emptyDraft,
  isDraftDirty,
  templateErrorMessage,
  toDraft,
  validateDraft,
  type TemplateDraft
} from './templateForm'
import { TextInput } from '../TextInput/TextInput'
import styles from './TemplatesDialog.module.css'

/** The `Workspace` dropdown's stand-in for "no workspace". A word, not '': it becomes part of
 *  the option's testid. Cannot collide with a workspace id (uuids, or the literal `default`). */
const GLOBAL_SCOPE = 'global'

export interface TemplateFormProps {
  template: Template | null
  onSaved: (saved: Template) => void
  onRemoved: () => void
}

export function TemplateForm({ template, onSaved, onRemoved }: TemplateFormProps): JSX.Element {
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    template === null ? emptyDraft() : toDraft(template)
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Workspaces (Task 11) — the scope select's options. useShallow: selectWorkspaces returns array.
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))

  const validation = validateDraft(draft)
  const dirty = isDraftDirty(draft, template)
  const canSave = validation.ok && dirty && !busy
  const patch = (p: Partial<TemplateDraft>): void => {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }

  async function browse(): Promise<void> {
    try {
      const cwd = await window.launch.pickDirectory()
      if (cwd !== null) patch({ cwd })
    } catch {
      console.warn('[claude-watcher][templates] code=pick_directory_failed')
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!validation.ok || !dirty) return
    setBusy(true)
    try {
      onSaved(await saveTemplate(validation.request))
    } catch (err) {
      setError(templateErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (template === null) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    await removeTemplate(template.id)
    setBusy(false)
    onRemoved()
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        // Escape peels ONE layer (UX-DR14): while Delete is armed it disarms and stops there,
        // so the dialog stays open. Unarmed, it bubbles to the overlay and closes the dialog.
        if (e.key === 'Escape' && confirmingDelete) {
          e.stopPropagation()
          setConfirmingDelete(false)
        }
      }}
    >
      <label className={styles.label} htmlFor="template-name">
        Name
      </label>
      <TextInput
        id="template-name"
        testId="template-name"
        maxLength={TEMPLATE_NAME_MAX_LENGTH}
        value={draft.name}
        onChange={(name) => patch({ name })}
      />

      <span className={styles.label}>Folder</span>
      <div className={styles.folderRow}>
        <span className={styles.path} data-testid="template-cwd">
          {draft.cwd.length > 0 ? draft.cwd : 'No folder yet'}
        </span>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid="template-browse"
          onClick={() => void browse()}
        >
          Browse…
        </button>
      </div>

      {/* A <span>, not a <label htmlFor>: the control is a button-and-listbox, which `for` cannot
          address. `ariaLabel` on the Select carries the name to assistive tech instead. */}
      <span className={styles.label}>Model</span>
      <div className={styles.modelRow}>
        <Select
          value={draft.modelChoice}
          options={MODEL_CHOICES}
          onChange={(modelChoice) => patch({ modelChoice })}
          ariaLabel="Model"
          testId="template-model"
        />
        {draft.modelChoice === 'custom' && (
          <TextInput
            testId="template-model-custom"
            ariaLabel="Model name"
            placeholder="claude-…"
            maxLength={MODEL_NAME_MAX_LENGTH}
            value={draft.customModel}
            onChange={(customModel) => patch({ customModel })}
          />
        )}
      </div>

      <span className={styles.label}>Permission mode</span>
      <Select
        value={draft.permissionChoice}
        options={PERMISSION_CHOICES}
        onChange={(permissionChoice) => patch({ permissionChoice })}
        ariaLabel="Permission mode"
        testId="template-permission"
      />

      <span className={styles.label}>Thinking effort</span>
      <Select
        value={draft.effortChoice}
        options={EFFORT_CHOICES}
        onChange={(effortChoice) => patch({ effortChoice })}
        ariaLabel="Thinking effort"
        testId="template-effort"
      />

      <span className={styles.label}>Workspace</span>
      {/* `'global'` ⇄ null. The sentinel is a WORD, not '': it ends up in the option's testid,
          and `template-scope-option-` with nothing after it is not a name anyone can read. A
          workspace id can never collide with it — ids are uuids or `default`. A NEW row defaults
          to Global (emptyDraft), never the active workspace: the non-surprising default,
          matching every template that predates scoping. */}
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
        onChange={(next) => patch({ workspaceId: next === GLOBAL_SCOPE ? null : next })}
        ariaLabel="Workspace"
        testId="template-scope"
      />

      {/* Why Save is disabled, once the operator has actually edited something. Muted hint —
          NOT role=alert: the `template-error` line below stays reserved for IPC failures. */}
      {dirty && !validation.ok && error === null && (
        <p className={styles.hint} data-testid="template-hint">
          {validation.error}
        </p>
      )}

      {error !== null && (
        <p className={styles.error} data-testid="template-error" role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {template !== null && (
          <button
            type="button"
            className={confirmingDelete ? styles.dangerButton : styles.deleteButton}
            data-testid="template-delete"
            disabled={busy}
            onClick={() => void remove()}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? 'Confirm delete' : 'Delete'}
          </button>
        )}
        <button
          type="submit"
          className={styles.primaryButton}
          data-testid="template-save"
          disabled={!canSave}
        >
          Save
        </button>
      </div>
    </form>
  )
}
