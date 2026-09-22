// Workspaces — the header switcher. Shows the active workspace with a grey count of its cards that
// do NOT need you and, when some do, a yellow pill INSIDE the button. Cards needing attention in OTHER
// workspaces go on a tab that slides out from BEHIND the button, carrying those workspaces' dots —
// a pill inside the button used to mean "elsewhere" too, and it read as "this one needs you"
// (alerts are global; only the CARDS are scoped — spec W-3). The popover's open state is LOCAL
// and transient, like NewSessionButton's.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  boardStore,
  selectCardCountByWorkspace,
  selectNeedsYouCountByWorkspace,
  useBoard
} from '../../stores/boardStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  setActiveWorkspace,
  useWorkspaces,
  workspacesStore
} from '../../stores/workspacesStore'
import { WorkspaceDot, type WorkspaceTone } from '../WorkspaceDot/WorkspaceDot'
import styles from './WorkspaceSwitcher.module.css'

/** The tab shows at most this many dots; the pill beside them still counts every card. */
const MAX_TAB_DOTS = 3

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Ops, 2 sessions, 1 needs you" — a workspace and its counts, read aloud. The needs-you part
 *  is dropped at zero. */
function describeCounts(name: string, total: number, needsYou: number): string {
  const base = `${name}, ${plural(total, 'session', 'sessions')}`
  return needsYou > 0 ? `${base}, ${plural(needsYou, 'needs', 'need')} you` : base
}

/** The grey number: the cards that do NOT need you — the pill beside it counts the rest, so
 *  "2 sessions, 1 needs you" reads `1 (1)`. Null (not rendered) when the pill already covers every
 *  card, so `0 (1)` never shows; an empty workspace still reads 0. */
function greyCount(total: number, needsYou: number): number | null {
  const rest = total - needsYou
  return rest === 0 && needsYou > 0 ? null : rest
}

export interface WorkspaceSwitcherProps {
  onManage: () => void
}

export function WorkspaceSwitcher({ onManage }: WorkspaceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const activeId = useWorkspaces(selectActiveWorkspaceId)
  const totals = useBoard(useShallow(selectCardCountByWorkspace))
  const counts = useBoard(useShallow(selectNeedsYouCountByWorkspace))

  const active = workspaces.find((w) => w.id === activeId) ?? null
  const activeName = active?.name ?? 'Workspace'
  const activeTotal = totals[activeId] ?? 0
  const here = counts[activeId] ?? 0
  const activeGrey = greyCount(activeTotal, here)
  const elsewhere = Object.entries(counts).reduce(
    (total, [id, count]) => (id === activeId ? total : total + count),
    0
  )
  // The OTHER workspaces that need you, in the list's order. A card whose workspace was deleted
  // still needs you: it comes last, with the orphan tone (it has no color of its own).
  const known = new Set(workspaces.map((w) => w.id))
  const elsewhereDots: { id: string; tone: WorkspaceTone }[] = [
    ...workspaces
      .filter((w) => w.id !== activeId && (counts[w.id] ?? 0) > 0)
      .map((w) => ({ id: w.id, tone: w.color })),
    ...Object.keys(counts)
      .filter((id) => !known.has(id))
      .map((id) => ({ id, tone: 'orphan' as const }))
  ]

  const label =
    describeCounts(activeName, activeTotal, here) +
    (elsewhere > 0
      ? `; ${plural(elsewhere, 'session needs', 'sessions need')} you in other workspaces`
      : '')

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
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <WorkspaceDot tone={active?.color ?? 'slate'} />
        <span className={styles.name}>{activeName}</span>
        {activeGrey !== null && (
          <span className={styles.count} data-testid="workspace-card-count">
            {activeGrey}
          </span>
        )}
        {here > 0 && (
          <span className={styles.badge} data-testid="workspace-here-badge">
            {here}
          </span>
        )}
      </button>
      {elsewhere > 0 && (
        // Not its own Tab-key stop: the button's aria-label already reads this count, and a
        // click here does exactly what the button does.
        <span
          className={styles.tab}
          data-testid="workspace-elsewhere-tab"
          aria-hidden="true"
          onClick={() => setOpen((v) => !v)}
        >
          {elsewhereDots.slice(0, MAX_TAB_DOTS).map(({ id, tone }) => (
            <span key={id} className={styles.tabDot} data-testid={`workspace-elsewhere-dot-${id}`}>
              <WorkspaceDot tone={tone} />
            </span>
          ))}
          <span className={styles.badge} data-testid="workspace-elsewhere-badge">
            {elsewhere}
          </span>
        </span>
      )}
      {open && (
        <div className={styles.menu} role="menu" onKeyDown={handleMenuKeyDown}>
          {workspaces.map((w) => {
            const total = totals[w.id] ?? 0
            const needsYou = counts[w.id] ?? 0
            const grey = greyCount(total, needsYou)
            return (
              <button
                key={w.id}
                type="button"
                role="menuitem"
                className={styles.row}
                data-testid={`workspace-row-${w.id}`}
                aria-current={w.id === activeId}
                aria-label={describeCounts(w.name, total, needsYou)}
                onClick={() => pick(w.id)}
              >
                <WorkspaceDot tone={w.color} />
                <span className={styles.rowName}>{w.name}</span>
                {/* Grey, then yellow — the button's order, so the pair reads the same everywhere. */}
                {grey !== null && (
                  <span className={styles.rowCount} data-testid={`workspace-row-count-${w.id}`}>
                    {grey}
                  </span>
                )}
                {needsYou > 0 && (
                  <span className={styles.badge} data-testid={`workspace-row-needs-${w.id}`}>
                    {needsYou}
                  </span>
                )}
              </button>
            )
          })}
          <div className={styles.divider} role="separator" />
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
