// Workspaces — the header switcher. Shows the active workspace and, when another workspace has
// sessions needing attention, a badge summing them (alerts are global; only the CARDS are
// scoped — spec W-3). The popover's open state is LOCAL and transient, like NewSessionButton's.
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { boardStore, selectNeedsYouCountByWorkspace, useBoard } from '../../stores/boardStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  setActiveWorkspace,
  useWorkspaces
} from '../../stores/workspacesStore'
import type { WorkspaceColor } from '../../../../shared/schemas/workspace'
import styles from './WorkspaceSwitcher.module.css'

export interface WorkspaceSwitcherProps {
  onManage: () => void
}

/** `noUncheckedIndexedAccess`-safe dot-color lookup: `styles` is a CSS-module index signature
 *  (`{ readonly [key: string]: string }`), so any index access — even with a `WorkspaceColor`
 *  literal — types as `string | undefined`. Fall back to `.slate` (always defined below) so the
 *  class list is never `undefined` in the DOM. */
function dotClass(color: WorkspaceColor): string {
  return styles[color] ?? styles.slate ?? ''
}

export function WorkspaceSwitcher({ onManage }: WorkspaceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const activeId = useWorkspaces(selectActiveWorkspaceId)
  const counts = useBoard(useShallow(selectNeedsYouCountByWorkspace))

  const active = workspaces.find((w) => w.id === activeId) ?? null
  // Sum only the OTHER workspaces: the active one's needs-you cards are already on screen, so
  // badging them would be noise pointing at what the operator is looking at.
  const elsewhere = Object.entries(counts).reduce(
    (total, [id, count]) => (id === activeId ? total : total + count),
    0
  )

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const pick = useCallback((id: string): void => {
    setOpen(false)
    buttonRef.current?.focus()
    // Persist first (main owns the pointer), THEN reconcile the focused view. Reconciling
    // optimistically would leave the view pointing at a workspace main refused to activate.
    void setActiveWorkspace(id).then(() => boardStore.getState().focusWorkspace(id))
  }, [])

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        data-testid="workspace-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`${styles.dot} ${dotClass(active?.color ?? 'slate')}`}
          aria-hidden="true"
        />
        <span className={styles.name}>{active?.name ?? 'Workspace'}</span>
        {elsewhere > 0 && (
          <span
            className={styles.badge}
            data-testid="workspace-elsewhere-badge"
            aria-label={`${elsewhere} sessions need you in other workspaces`}
          >
            {elsewhere}
          </span>
        )}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              className={styles.row}
              data-testid={`workspace-row-${w.id}`}
              aria-current={w.id === activeId}
              onClick={() => pick(w.id)}
            >
              <span className={`${styles.dot} ${dotClass(w.color)}`} aria-hidden="true" />
              <span className={styles.rowName}>{w.name}</span>
              {(counts[w.id] ?? 0) > 0 && <span className={styles.rowCount}>{counts[w.id]}</span>}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={styles.manage}
            data-testid="workspace-manage"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            Manage workspaces…
          </button>
        </div>
      )}
    </div>
  )
}
