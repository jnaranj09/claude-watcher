// Workspaces — the Manage dialog (modal, z 60 like TemplatesDialog/ShortcutsDialog). Modelled on
// TemplatesDialog.tsx's shell: role="dialog", aria-modal, the Escape handler, the mount-focus
// trap, and a list + form split. UX-DR14: App.tsx guards it against the other modals via
// isModalOpen() and closes it on the quit guard.
//
// Delete lives on the LIST side (not the form): it is two-step per row (`workspace-delete-<id>`
// arms an inline confirm; `workspace-delete-confirm` commits) and the Default workspace's row
// never renders a delete control at all — main also refuses it, but the UI must not offer it.
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
import type { Workspace, WorkspaceSaveRequest } from '../../../../shared/ipc/contract'
import {
  removeWorkspace,
  saveWorkspace,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
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

/** `noUncheckedIndexedAccess`-safe dot-color lookup — mirrors WorkspaceSwitcher.tsx's helper. */
function dotClass(color: WorkspaceColor): string {
  return styles[color] ?? styles.slate ?? ''
}

interface WorkspaceRowProps {
  workspace: Workspace
  selected: boolean
  armed: boolean
  busy: boolean
  onSelect: () => void
  onArm: () => void
  onCancelArm: () => void
  onConfirmDelete: () => void
}

function WorkspaceRow({
  workspace,
  selected,
  armed,
  busy,
  onSelect,
  onArm,
  onCancelArm,
  onConfirmDelete
}: WorkspaceRowProps): JSX.Element {
  return (
    <div
      className={styles.row}
      data-testid={`workspace-item-${workspace.id}`}
      data-selected={selected}
    >
      <button type="button" className={styles.rowMain} onClick={onSelect}>
        <span className={`${styles.dot} ${dotClass(workspace.color)}`} aria-hidden="true" />
        <span className={styles.rowName}>{workspace.name}</span>
        <span className={styles.rowFolder}>{workspace.defaultCwd ?? 'None'}</span>
      </button>
      {/* The Default workspace is undeletable (main refuses it too), so its row renders NO
          delete control at all — `workspace-delete-default` must not exist. */}
      {workspace.id !== DEFAULT_WORKSPACE_ID && !armed && (
        <button
          type="button"
          className={styles.ghostButton}
          data-testid={`workspace-delete-${workspace.id}`}
          onClick={onArm}
        >
          Delete
        </button>
      )}
      {armed && (
        <div className={styles.confirmRow}>
          <p className={styles.hint} data-testid="workspace-delete-confirm-text">
            {`Delete ${workspace.name}? Any templates and shortcuts scoped to it are deleted too. This cannot be undone.`}
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={busy}
              onClick={onCancelArm}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              data-testid="workspace-delete-confirm"
              disabled={busy}
              onClick={onConfirmDelete}
            >
              Confirm delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface WorkspaceFormProps {
  workspace: Workspace | null
  onSaved: (saved: Workspace) => void
  onError: (message: string) => void
}

/** Keyed by the selected id in WorkspacesDialog, so a selection change remounts it with a fresh
 *  draft (no effect-based syncing) — same reasoning as TemplateForm.tsx. */
function WorkspaceForm({ workspace, onSaved, onError }: WorkspaceFormProps): JSX.Element {
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

  return (
    <form className={styles.form} data-testid="workspace-form" onSubmit={(e) => void submit(e)}>
      <label className={styles.label} htmlFor="workspace-name">
        Name
      </label>
      <input
        id="workspace-name"
        type="text"
        className={styles.input}
        data-testid="workspace-name-input"
        maxLength={WORKSPACE_NAME_MAX_LENGTH}
        value={name}
        onChange={(e) => setName(e.target.value)}
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
            <span className={`${styles.dot} ${dotClass(c)}`} aria-hidden="true" />
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

      <div className={styles.actions}>
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
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)
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
    setArmedDeleteId(null)
    setError(null)
  }

  function startNew(): void {
    setSelectedId(null)
    setArmedDeleteId(null)
    setError(null)
  }

  async function commitDelete(id: string): Promise<void> {
    setDeleteBusy(true)
    try {
      await removeWorkspace(id)
      setArmedDeleteId(null)
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
                  armed={armedDeleteId === w.id}
                  busy={deleteBusy}
                  onSelect={() => selectWorkspace(w.id)}
                  onArm={() => {
                    setArmedDeleteId(w.id)
                    setError(null)
                  }}
                  onCancelArm={() => setArmedDeleteId(null)}
                  onConfirmDelete={() => void commitDelete(w.id)}
                />
              ))}
            </div>
            <button
              type="button"
              className={styles.ghostButton}
              data-testid="workspace-new"
              onClick={startNew}
            >
              + New
            </button>
          </div>
          <WorkspaceForm
            key={selected?.id ?? 'new'}
            workspace={selected}
            onSaved={(saved) => {
              setSelectedId(saved.id)
              setError(null)
            }}
            onError={setError}
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
