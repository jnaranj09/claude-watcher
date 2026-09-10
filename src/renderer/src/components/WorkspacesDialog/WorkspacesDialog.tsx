// Workspaces — the Manage dialog (modal, z 60 like TemplatesDialog/ShortcutsDialog). Modelled on
// TemplatesDialog.tsx's shell: role="dialog", aria-modal, the Escape handler, the mount-focus
// trap, and a list + form split. UX-DR14: App.tsx guards it against the other modals via
// isModalOpen() and closes it on the quit guard.
//
// Delete lives in the FORM footer beside Save — the shape TemplateForm.tsx and ShortcutRow.tsx
// already use (see .claude/rules/design.md): ONE button that arms in place and commits on the
// second press, with Escape or blur disarming it. The two-step keeps its two test ids on that one
// button (`workspace-delete-<id>` armed → `workspace-delete-confirm`) precisely so a test cannot
// commit a delete with a single click. The Default workspace renders NO delete control at all —
// main also refuses it, but the UI must not offer it.
//
// Never render a raw thrown error: every IPC rejection is mapped through `copyFor()` to
// operator-facing copy (an unknown code falls back to a generic sentence) before it reaches the
// ONE shared `workspace-error` line, which both the list's delete flow and the form's save flow
// report through (`onError`) rather than each owning its own error surface.
import { useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_COLORS,
  WORKSPACE_NAME_MAX_LENGTH,
  type WorkspaceColor
} from '../../../../shared/schemas/workspace'
import { WorkspaceDot } from '../WorkspaceDot/WorkspaceDot'
import type { Workspace, WorkspaceSaveRequest } from '../../../../shared/ipc/contract'
import { loadShortcuts } from '../../stores/shortcutsStore'
import { loadTemplates } from '../../stores/templatesStore'
import {
  removeWorkspace,
  saveWorkspace,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { TextInput } from '../TextInput/TextInput'
import styles from './WorkspacesDialog.module.css'

export interface WorkspacesDialogProps {
  onClose: () => void
}

const ERROR_COPY: Record<string, string> = {
  workspace_name_taken: 'A workspace with that name already exists.',
  workspace_has_sessions: 'That workspace still has running sessions. Stop or move them first.',
  workspace_default_undeletable: 'The Default workspace cannot be deleted.',
  workspace_not_found: 'That workspace no longer exists.'
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

interface WorkspaceRowProps {
  workspace: Workspace
  selected: boolean
  onSelect: () => void
}

function WorkspaceRow({ workspace, selected, onSelect }: WorkspaceRowProps): JSX.Element {
  return (
    <div
      className={styles.row}
      data-testid={`workspace-item-${workspace.id}`}
      data-selected={selected}
    >
      <button
        type="button"
        className={styles.rowMain}
        data-testid={`workspace-select-${workspace.id}`}
        onClick={onSelect}
      >
        <WorkspaceDot tone={workspace.color} />
        <span className={styles.rowName}>{workspace.name}</span>
        <span className={styles.rowFolder}>{workspace.defaultCwd ?? 'None'}</span>
      </button>
    </div>
  )
}

interface WorkspaceFormProps {
  workspace: Workspace | null
  deleteBusy: boolean
  onSaved: (saved: Workspace) => void
  onError: (message: string | null) => void
  onDelete: () => void
}

/** Keyed by the selected id in WorkspacesDialog, so a selection change remounts it with a fresh
 *  draft (no effect-based syncing) — same reasoning as TemplateForm.tsx. That remount is also what
 *  disarms a left-over Delete: an armed confirm can never follow the operator to another row. */
function WorkspaceForm({
  workspace,
  deleteBusy,
  onSaved,
  onError,
  onDelete
}: WorkspaceFormProps): JSX.Element {
  const [armed, setArmed] = useState(false)
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
      onError(copyFor(err))
    } finally {
      setBusy(false)
    }
  }

  function handleDelete(): void {
    if (!armed) {
      setArmed(true)
      onError(null)
      return
    }
    onDelete()
  }

  return (
    <form
      className={styles.form}
      data-testid="workspace-form"
      onSubmit={(e) => void submit(e)}
      // Escape peels ONE layer (UX-DR14), same as TemplateForm.tsx: while Delete is armed it
      // disarms and stops there, so the keypress never reaches the dialog's close handler.
      onKeyDown={(e: KeyboardEvent<HTMLFormElement>) => {
        if (e.key === 'Escape' && armed) {
          e.stopPropagation()
          setArmed(false)
        }
      }}
    >
      <label className={styles.label} htmlFor="workspace-name">
        Name
      </label>
      <TextInput
        id="workspace-name"
        testId="workspace-name-input"
        maxLength={WORKSPACE_NAME_MAX_LENGTH}
        value={name}
        onChange={setName}
      />

      <span className={styles.label}>Color</span>
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

      <span className={styles.label}>Default folder</span>
      <div className={styles.folderRow}>
        <span className={styles.path} data-testid="workspace-default-cwd">
          {defaultCwd ?? 'None'}
        </span>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid="workspace-browse"
          onClick={() => void browse()}
        >
          Choose…
        </button>
      </div>

      {/* The cascade warning — the one thing this Delete says that Templates' does not, because
          deleting a workspace also deletes every template and shortcut scoped to it. */}
      {workspace !== null && workspace.id !== DEFAULT_WORKSPACE_ID && armed && (
        <p className={styles.hint} data-testid="workspace-delete-confirm-text">
          {`Delete ${workspace.name}? Any templates and shortcuts scoped to it are deleted too. This cannot be undone.`}
        </p>
      )}

      <div className={styles.actions}>
        {workspace !== null && workspace.id !== DEFAULT_WORKSPACE_ID && (
          <button
            type="button"
            className={armed ? styles.dangerButton : styles.deleteButton}
            data-testid={armed ? 'workspace-delete-confirm' : `workspace-delete-${workspace.id}`}
            disabled={deleteBusy}
            onClick={handleDelete}
            onBlur={() => setArmed(false)}
          >
            {armed ? 'Confirm delete' : 'Delete'}
          </button>
        )}
        <button
          type="submit"
          className={styles.primaryButton}
          data-testid="workspace-submit"
          disabled={!canSave}
        >
          {workspace === null ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  )
}

export function WorkspacesDialog({ onClose }: WorkspacesDialogProps): JSX.Element {
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // An aria-modal dialog must take focus on mount, or Escape/Tab keep going to whatever was
  // focused behind it (a11y defect) — same reasoning as TemplateList.tsx's search-input focus.
  // There is no persistent list-side input here, so the close button is the mount-stable target.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const selected = workspaces.find((w) => w.id === selectedId) ?? null

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  function selectWorkspace(id: string): void {
    setSelectedId(id)
    setError(null)
  }

  function startNew(): void {
    setSelectedId(null)
    setError(null)
  }

  async function commitDelete(id: string): Promise<void> {
    setDeleteBusy(true)
    try {
      await removeWorkspace(id)
      // A committed delete CASCADES in main (templatesStore/shortcutsStore removeByWorkspace),
      // and nothing else tells the renderer: loadTemplates/loadShortcuts otherwise run ONLY at
      // startup. Without this re-read the deleted rows sit in the two projections until an
      // unrelated round-trip or a restart — and since their workspace is gone, the Manage
      // dialogs file them under `(no workspace)`, where they look legitimate and saving one
      // throws template_not_found on a row the UI is showing. Neither loader throws (each logs
      // a code and leaves its projection alone), so this cannot turn a successful delete into
      // an error. Only on the SUCCESS path — a refused delete cascaded nothing.
      await Promise.all([loadTemplates(), loadShortcuts()])
      setError(null)
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      setError(copyFor(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Workspaces"
      data-testid="workspaces-overlay"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.panel} data-testid="workspaces-panel">
        <div className={styles.header}>
          <span className={styles.title}>Workspaces</span>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeButton}
            data-testid="workspaces-close"
            aria-label="Close workspaces"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className={styles.columns}>
          <div className={styles.list}>
            <div className={styles.rows}>
              {workspaces.map((w) => (
                <WorkspaceRow
                  key={w.id}
                  workspace={w}
                  selected={w.id === selected?.id}
                  onSelect={() => selectWorkspace(w.id)}
                />
              ))}
            </div>
            <button
              type="button"
              className={`${styles.ghostButton} ${styles.newButton}`}
              data-testid="workspace-new"
              onClick={startNew}
            >
              + New
            </button>
          </div>
          <WorkspaceForm
            key={selected?.id ?? 'new'}
            workspace={selected}
            deleteBusy={deleteBusy}
            onSaved={(saved) => {
              setSelectedId(saved.id)
              setError(null)
            }}
            onError={setError}
            onDelete={() => {
              if (selected !== null) void commitDelete(selected.id)
            }}
          />
        </div>
        {error !== null && (
          <p className={styles.error} data-testid="workspace-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
