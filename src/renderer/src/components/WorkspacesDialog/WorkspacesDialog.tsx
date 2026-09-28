// Workspaces — the Manage dialog, on the shared ManageDialog shell (.claude/rules/design.md): the
// overlay, header, list rail, form footer, arm-in-place Delete and the ONE error line are
// ManageDialog parts. This file keeps only what is Workspaces': the fields, the cascade warning,
// the Default rule and the cascade re-read. UX-DR14: App.tsx guards it against the other modals via
// isModalOpen() and closes it on the quit guard.
//
// Delete keeps its two test ids (`workspace-delete-<id>` resting → `workspace-delete-confirm`
// armed) precisely so a test cannot commit a delete with a single click. The Default workspace
// renders NO delete control at all — main also refuses it, but the UI must not offer it.
//
// Never render a raw thrown error: every IPC rejection is mapped through `copyFor()` to
// operator-facing copy before it reaches the shared error line, which both the delete flow and
// the save flow report through.
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_COLORS,
  WORKSPACE_NAME_MAX_LENGTH,
  type WorkspaceColor
} from '../../../../shared/schemas/workspace'
import { WorkspaceDot } from '../WorkspaceDot/WorkspaceDot'
import type { Workspace, WorkspaceSaveRequest } from '../../../../shared/ipc/contract'
import { boardStore } from '../../stores/boardStore'
import { loadRules } from '../../stores/rulesStore'
import { loadShortcuts } from '../../stores/shortcutsStore'
import { loadTags } from '../../stores/tagsStore'
import { loadTemplates } from '../../stores/templatesStore'
import {
  removeWorkspace,
  saveWorkspace,
  selectWorkspaces,
  useWorkspaces,
  workspacesStore
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { TextInput } from '../TextInput/TextInput'
import styles from './WorkspacesDialog.module.css'

export interface WorkspacesDialogProps {
  onClose: () => void
}

const ERROR_COPY: Record<string, string> = {
  workspace_name_taken: 'A workspace with that name already exists.',
  workspace_has_sessions: 'That workspace still has running sessions. Stop or move them first.',
  workspace_default_undeletable: 'The Default workspace cannot be deleted.',
  workspace_not_found: 'That workspace no longer exists.',
  [STORE_WRITE_FAILED]: STORE_WRITE_FAILED_COPY
}

/** Maps a thrown IPC error to operator-facing copy. NEVER render `error.message` directly — it
 *  is a fixed code today, but the fallback keeps an unrecognized string off the screen too.
 *
 *  Matched with `.includes(...)`, NOT `===`: main throws `new Error('workspace_has_sessions')`
 *  and Electron wraps it as `Error invoking remote method '…': Error: <code>` on the way across
 *  the seam, so an exact-key lookup NEVER hits and every code falls through to the fallback.
 *  Same reasoning (and the same verified behavior) as `templateErrorMessage` in
 *  TemplatesDialog/templateForm.ts and `shortcutErrorCode` in ShortcutsDialog/shortcutForm.ts. */
function copyFor(error: unknown): string {
  const text = error instanceof Error ? error.message : ''
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return 'Something went wrong. Try again.'
}

interface WorkspaceFormProps {
  workspace: Workspace | null
  deleteBusy: boolean
  onSaved: (saved: Workspace) => void
  onDelete: () => void
}

/** Keyed by the selected id in WorkspacesDialog, so a selection change remounts it with a fresh
 *  draft (no effect-based syncing) — same reasoning as TemplateForm.tsx. The armed Delete lives in
 *  the shell's state, and `select()` disarms it, so an armed confirm can never follow the operator
 *  to another row either. */
function WorkspaceForm({
  workspace,
  deleteBusy,
  onSaved,
  onDelete
}: WorkspaceFormProps): JSX.Element {
  const { state, actions } = useManageDialogContext()
  const [name, setName] = useState(workspace?.name ?? '')
  const [color, setColor] = useState<WorkspaceColor>(workspace?.color ?? 'slate')
  const [defaultCwd, setDefaultCwd] = useState<string | null>(workspace?.defaultCwd ?? null)
  const [busy, setBusy] = useState(false)

  async function browse(): Promise<void> {
    try {
      const cwd = await window.launch.pickDirectory()
      if (cwd !== null) setDefaultCwd(cwd)
    } catch {
      console.warn('[claude-watcher][workspaces] code=pick_directory_failed')
    }
  }

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && !busy

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      const req: WorkspaceSaveRequest =
        workspace === null
          ? { name: trimmed, color, defaultCwd }
          : { id: workspace.id, name: trimmed, color, defaultCwd }
      onSaved(await saveWorkspace(req))
    } catch (err) {
      actions.setError(copyFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ManageDialog.Form testId="workspace-form" onSubmit={(e) => void submit(e)}>
      <ManageDialog.Label htmlFor="workspace-name">Name</ManageDialog.Label>
      <TextInput
        id="workspace-name"
        testId="workspace-name-input"
        maxLength={WORKSPACE_NAME_MAX_LENGTH}
        value={name}
        onChange={setName}
      />

      <ManageDialog.Label>Color</ManageDialog.Label>
      <div className={styles.colorRow} role="radiogroup" aria-label="Color">
        {WORKSPACE_COLORS.map((c) => (
          <label key={c} className={styles.colorOption}>
            <input
              type="radio"
              name="workspace-color"
              value={c}
              aria-label={c}
              data-testid={`workspace-color-${c}`}
              checked={color === c}
              onChange={() => setColor(c)}
            />
            <WorkspaceDot tone={c} />
          </label>
        ))}
      </div>

      <ManageDialog.Label>Default folder</ManageDialog.Label>
      <div className={styles.folderRow}>
        <span className={styles.path} data-testid="workspace-default-cwd">
          {defaultCwd ?? 'None'}
        </span>
        <ManageDialog.GhostButton testId="workspace-browse" onClick={() => void browse()}>
          Choose…
        </ManageDialog.GhostButton>
      </div>

      {/* The cascade warning — the one thing this Delete says that Templates' does not, because
          deleting a workspace also deletes everything scoped to it: templates, shortcuts, tags,
          rules and past sessions (main's `cascade()`; UX-09 — rules and past sessions were left
          out and went silently). */}
      {workspace !== null && workspace.id !== DEFAULT_WORKSPACE_ID && state.armed && (
        <ManageDialog.Hint testId="workspace-delete-confirm-text">
          {`Delete ${workspace.name}? Its templates, shortcuts, tags, rules and past sessions are deleted too. This cannot be undone.`}
        </ManageDialog.Hint>
      )}

      <ManageDialog.Footer>
        {workspace !== null && workspace.id !== DEFAULT_WORKSPACE_ID && (
          <ManageDialog.Delete
            testId={`workspace-delete-${workspace.id}`}
            armedTestId="workspace-delete-confirm"
            disabled={deleteBusy}
            onConfirm={onDelete}
          />
        )}
        <ManageDialog.Save testId="workspace-submit" disabled={!canSave}>
          {workspace === null ? 'Create' : 'Save'}
        </ManageDialog.Save>
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}

export function WorkspacesDialog({ onClose }: WorkspacesDialogProps): JSX.Element {
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const dialog = useManageDialog({ title: 'Workspaces', testIdPrefix: 'workspaces', onClose })
  const { closeRef } = dialog.meta
  const [deleteBusy, setDeleteBusy] = useState(false)

  // An aria-modal dialog must take focus on mount, or Escape/Tab keep going to whatever was
  // focused behind it (a11y defect) — same reasoning as TemplateList.tsx's search-input focus.
  // There is no persistent list-side input here, so the ✕ is the mount-stable target.
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  const selected = workspaces.find((w) => w.id === dialog.state.selectedId) ?? null

  async function commitDelete(id: string): Promise<void> {
    setDeleteBusy(true)
    const wasActive = workspacesStore.getState().activeId === id
    try {
      await removeWorkspace(id)
      // UX-18: deleting the ACTIVE workspace moves main's pointer to Default, but the focused
      // view can still hold one of the deleted workspace's dead panes (a natural exit removes the
      // session from main, so the delete is allowed while the pane stays mounted). Reconcile the
      // way an explicit switch does (WorkspaceSwitcher `pick`), or Focused shows a terminal of a
      // workspace that no longer exists.
      const activeId = workspacesStore.getState().activeId
      if (wasActive && activeId !== id) boardStore.getState().focusWorkspace(activeId)
      // A committed delete CASCADES in main (templates, shortcuts, the tag catalog and rules all
      // removeByWorkspace), and nothing else tells the renderer: the four loaders otherwise run
      // ONLY at startup. Without this re-read the deleted rows sit in the projections until an
      // unrelated round-trip or a restart — and since their workspace is gone, the Manage dialogs
      // file them under `(no workspace)`, where they look legitimate: saving one throws
      // template_not_found / rule_not_found, ↑/↓ on a rule silently fail, and a deleted rule still
      // counts in "Used by N rules". None of the loaders throw (each logs a code and leaves its
      // projection alone), so this cannot turn a successful delete into an error. Only on the
      // SUCCESS path — a refused delete cascaded nothing, so re-reading would be pointless work.
      await Promise.all([loadTemplates(), loadShortcuts(), loadTags(), loadRules()])
      // The deleted row was the selected one: back to the New form. `select` also clears the
      // error line and the armed Delete.
      dialog.actions.select(null)
    } catch (err) {
      dialog.actions.setError(copyFor(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header />
        <ManageDialog.Columns>
          <ManageDialog.List size="wide">
            <ManageDialog.Rows>
              {workspaces.map((w) => (
                <ManageDialog.Row
                  key={w.id}
                  id={w.id}
                  testId={`workspace-item-${w.id}`}
                  selectTestId={`workspace-select-${w.id}`}
                >
                  <WorkspaceDot tone={w.color} />
                  <span className={styles.rowName}>{w.name}</span>
                  <span className={styles.rowFolder}>{w.defaultCwd ?? 'None'}</span>
                </ManageDialog.Row>
              ))}
            </ManageDialog.Rows>
            <ManageDialog.New testId="workspace-new" />
          </ManageDialog.List>
          <WorkspaceForm
            key={selected?.id ?? 'new'}
            workspace={selected}
            deleteBusy={deleteBusy}
            onSaved={(saved) => dialog.actions.select(saved.id)}
            onDelete={() => {
              if (selected !== null) void commitDelete(selected.id)
            }}
          />
        </ManageDialog.Columns>
        <ManageDialog.Error testId="workspace-error" />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
