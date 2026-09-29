// Workspaces — the header switcher. Shows the active workspace with one pill per column: grey for
// its idle cards, blue for the working ones and yellow for the ones that need you, INSIDE the
// button; a pill at 0 is not drawn. Cards needing attention in OTHER
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
  selectWorkingCountByWorkspace,
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

/** "Ops, 3 sessions, 1 working, 1 needs you" — a workspace and its counts, read aloud. The
 *  working and needs-you parts are dropped at zero. */
function describeCounts(name: string, total: number, working: number, needsYou: number): string {
  let text = `${name}, ${plural(total, 'session', 'sessions')}`
  if (working > 0) text += `, ${working} working`
  if (needsYou > 0) text += `, ${plural(needsYou, 'needs', 'need')} you`
  return text
}

/** The grey number: the cards that are neither working nor need you (the idle column) — the blue
 *  and yellow pills beside it count the rest, so "3 sessions, 1 working, 1 needs you" reads
 *  `1 (1) (1)`. Null (not rendered) whenever it would be 0: a grey 0 was noise (operator,
 *  2026-09-25); the aria-label still reads the true total. */
function greyCount(total: number, working: number, needsYou: number): number | null {
  const rest = total - working - needsYou
  return rest === 0 ? null : rest
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
  const workingCounts = useBoard(useShallow(selectWorkingCountByWorkspace))

  const active = workspaces.find((w) => w.id === activeId) ?? null
  const others = workspaces.filter((w) => w.id !== activeId)
  const activeName = active?.name ?? 'Workspace'
  const activeTotal = totals[activeId] ?? 0
  const here = counts[activeId] ?? 0
  const activeWorking = workingCounts[activeId] ?? 0
  const activeGrey = greyCount(activeTotal, activeWorking, here)
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
    describeCounts(activeName, activeTotal, activeWorking, here) +
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
        className={styles.switcher}
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
        {activeWorking > 0 && (
          <span className={styles.working} data-testid="workspace-working-count">
            {activeWorking}
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
          {/* The OTHER workspaces only: the button already names the active one, and listing it
              again read as a duplicate (operator, 2026-09-28). */}
          {others.map((w) => {
            const total = totals[w.id] ?? 0
            const needsYou = counts[w.id] ?? 0
            const working = workingCounts[w.id] ?? 0
            const grey = greyCount(total, working, needsYou)
            return (
              <button
                key={w.id}
                type="button"
                role="menuitem"
                className={styles.row}
                data-testid={`workspace-row-${w.id}`}
                aria-label={describeCounts(w.name, total, working, needsYou)}
                onClick={() => pick(w.id)}
              >
                <WorkspaceDot tone={w.color} />
                <span className={styles.rowName}>{w.name}</span>
                {/* Grey, blue, yellow — the button's order, so the pills read the same everywhere. */}
                {grey !== null && (
                  <span className={styles.rowCount} data-testid={`workspace-row-count-${w.id}`}>
                    {grey}
                  </span>
                )}
                {working > 0 && (
                  <span className={styles.working} data-testid={`workspace-row-working-${w.id}`}>
                    {working}
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
          {others.length > 0 && <div className={styles.divider} role="separator" />}
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
