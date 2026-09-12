// Session templates — the edit form. Keyed by the selected id in TemplatesDialog, so a
// selection change remounts it with a fresh draft (no effect-based syncing). The armed Delete and
// the error line are the ManageDialog shell's state, so they reset on a selection change too.
import { useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import {
  TEMPLATE_NAME_MAX_LENGTH,
  MODEL_NAME_MAX_LENGTH
} from '../../../../shared/schemas/template'
import { removeTemplate, saveTemplate } from '../../stores/templatesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
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
  const { state, actions } = useManageDialogContext()
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    template === null ? emptyDraft() : toDraft(template)
  )
  const [busy, setBusy] = useState(false)
  // Workspaces (Task 11) — the scope select's options. useShallow: selectWorkspaces returns array.
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))

  const validation = validateDraft(draft)
  const dirty = isDraftDirty(draft, template)
  const canSave = validation.ok && dirty && !busy
  const patch = (p: Partial<TemplateDraft>): void => {
    setDraft((d) => ({ ...d, ...p }))
    actions.setError(null)
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
      actions.setError(templateErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** The second press of Delete — ManageDialog.Delete owns the first (arm). */
  async function remove(): Promise<void> {
    if (template === null) return
    setBusy(true)
    await removeTemplate(template.id)
    setBusy(false)
    onRemoved()
  }

  return (
    <ManageDialog.Form onSubmit={(e) => void submit(e)}>
      <ManageDialog.Label htmlFor="template-name">Name</ManageDialog.Label>
      <TextInput
        id="template-name"
        testId="template-name"
        maxLength={TEMPLATE_NAME_MAX_LENGTH}
        value={draft.name}
        onChange={(name) => patch({ name })}
      />

      <ManageDialog.Label>Folder</ManageDialog.Label>
      <div className={styles.folderRow}>
        <span className={styles.path} data-testid="template-cwd">
          {draft.cwd.length > 0 ? draft.cwd : 'No folder yet'}
        </span>
        <ManageDialog.GhostButton testId="template-browse" onClick={() => void browse()}>
          Browse…
        </ManageDialog.GhostButton>
      </div>

      {/* A <span> (Label without htmlFor), not a <label for>: the control is a button-and-listbox,
          which `for` cannot address. `ariaLabel` on the Select carries the name instead. */}
      <ManageDialog.Label>Model</ManageDialog.Label>
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

      <ManageDialog.Label>Permission mode</ManageDialog.Label>
      <Select
        value={draft.permissionChoice}
        options={PERMISSION_CHOICES}
        onChange={(permissionChoice) => patch({ permissionChoice })}
        ariaLabel="Permission mode"
        testId="template-permission"
      />

      <ManageDialog.Label>Thinking effort</ManageDialog.Label>
      <Select
        value={draft.effortChoice}
        options={EFFORT_CHOICES}
        onChange={(effortChoice) => patch({ effortChoice })}
        ariaLabel="Thinking effort"
        testId="template-effort"
      />

      <ManageDialog.Label>Workspace</ManageDialog.Label>
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
      {dirty && !validation.ok && state.error === null && (
        <ManageDialog.Hint testId="template-hint">{validation.error}</ManageDialog.Hint>
      )}

      {/* The dialog's ONE error line. It reads the shell's state, so it can sit here, right above
          the button whose failure it reports — where it has always been. */}
      <ManageDialog.Error testId="template-error" />

      <ManageDialog.Footer>
        {template !== null && (
          <ManageDialog.Delete
            testId="template-delete"
            disabled={busy}
            onConfirm={() => void remove()}
          />
        )}
        <ManageDialog.Save testId="template-save" disabled={!canSave} />
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}
