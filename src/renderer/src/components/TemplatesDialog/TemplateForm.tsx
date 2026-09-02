// Session templates — the edit form. Keyed by the selected id in TemplatesDialog, so a
// selection change remounts it with a fresh draft (no effect-based syncing).
import { useState, type FormEvent, type JSX } from 'react'
import type { Template } from '../../../../shared/ipc/contract'
import {
  TEMPLATE_NAME_MAX_LENGTH,
  MODEL_NAME_MAX_LENGTH
} from '../../../../shared/schemas/template'
import { removeTemplate, saveTemplate } from '../../stores/templatesStore'
import {
  MODEL_CHOICES,
  PERMISSION_CHOICES,
  emptyDraft,
  isDraftDirty,
  templateErrorMessage,
  toDraft,
  validateDraft,
  type ModelChoice,
  type PermissionChoice,
  type TemplateDraft
} from './templateForm'
import styles from './TemplatesDialog.module.css'

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
      <input
        id="template-name"
        type="text"
        className={styles.input}
        data-testid="template-name"
        maxLength={TEMPLATE_NAME_MAX_LENGTH}
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
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

      <label className={styles.label} htmlFor="template-model">
        Model
      </label>
      <div className={styles.modelRow}>
        <select
          id="template-model"
          className={styles.select}
          data-testid="template-model"
          value={draft.modelChoice}
          onChange={(e) => patch({ modelChoice: e.target.value as ModelChoice })}
        >
          {MODEL_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {draft.modelChoice === 'custom' && (
          <input
            type="text"
            className={styles.input}
            data-testid="template-model-custom"
            aria-label="Model name"
            placeholder="claude-…"
            maxLength={MODEL_NAME_MAX_LENGTH}
            value={draft.customModel}
            onChange={(e) => patch({ customModel: e.target.value })}
          />
        )}
      </div>

      <label className={styles.label} htmlFor="template-permission">
        Permission mode
      </label>
      <select
        id="template-permission"
        className={styles.select}
        data-testid="template-permission"
        value={draft.permissionChoice}
        onChange={(e) => patch({ permissionChoice: e.target.value as PermissionChoice })}
      >
        {PERMISSION_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

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
            className={confirmingDelete ? styles.dangerButton : styles.ghostButton}
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
