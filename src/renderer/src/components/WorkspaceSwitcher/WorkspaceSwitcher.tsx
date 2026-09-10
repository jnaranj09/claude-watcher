// Workspaces — the header switcher. Shows the active workspace and, when another workspace has
// sessions needing attention, a badge summing them (alerts are global; only the CARDS are
// scoped — spec W-3). The popover's open state is LOCAL and transient, like NewSessionButton's.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { boardStore, selectNeedsYouCountByWorkspace, useBoard } from '../../stores/boardStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  setActiveWorkspace,
  useWorkspaces,
  workspacesStore
} from '../../stores/workspacesStore'
import { WorkspaceDot } from '../WorkspaceDot/WorkspaceDot'
import styles from './WorkspaceSwitcher.module.css'

export interface WorkspaceSwitcherProps {
  onManage: () => void
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

  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  // Mirrors NewSessionMenu.tsx's handleKeyDown: Escape closes and returns focus to the trigger.
  // No roving arrow-key focus — the sibling doesn't have it either; native Tab order through the
  // menu buttons is the bar this component matches, not exceeds.
  const handleMenuKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeAndRefocus()
      }
    },
    [closeAndRefocus]
  )

  const pick = useCallback(
    (id: string): void => {
      closeAndRefocus()
      // Persist first (main owns the pointer), THEN reconcile the focused view — but only if
      // main actually confirmed the switch. `setActiveWorkspace` SWALLOWS an IPC failure (it
      // only `console.warn`s — workspacesStore.ts) so a RESOLVED promise is not proof the switch
      // happened. Reconciling unconditionally would point the focused view at a workspace the
      // board/rail are not showing (`selectRailActiveSessionId` is unfiltered by workspace).
      void setActiveWorkspace(id).then(() => {
        if (workspacesStore.getState().activeId === id) boardStore.getState().focusWorkspace(id)
      })
    },
    [closeAndRefocus]
  )

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
        <WorkspaceDot tone={active?.color ?? 'slate'} />
        <span className={styles.name}>{active?.name ?? 'Workspace'}</span>
        {elsewhere > 0 && (
          <span
            className={styles.badge}
            data-testid="workspace-elsewhere-badge"
            aria-label={`${elsewhere} ${elsewhere === 1 ? 'session needs' : 'sessions need'} you in other workspaces`}
          >
            {elsewhere}
          </span>
        )}
      </button>
      {open && (
        <div className={styles.menu} role="menu" onKeyDown={handleMenuKeyDown}>
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
              <WorkspaceDot tone={w.color} />
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
