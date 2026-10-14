// Workspaces — the header switcher. Shows the active workspace (a lucide `layers` icon, the same
// for every workspace, then its name) with one pill per column: grey for its idle cards, blue for
// the working ones and yellow for the ones that need you, INSIDE the button; a pill at 0 is not
// drawn. Cards in OTHER workspaces go on a tab that slides out from
// BEHIND the button: a neutral tab — no colour, a workspace's colour there was read as a status
// (spec 2026-09-29) — carrying the same grey / blue / yellow pills as the button, summed over the
// other workspaces (an empty tab told the operator nothing — operator, 2026-09-30). A pill inside
// the button used to mean "elsewhere" too, and it read as "this one needs you" (alerts are global;
// only the CARDS are scoped — spec W-3); the tab keeps the two apart. While the menu is open the tab
// slides back BEHIND the button: every other workspace is then a row with its own pills, and the tab's
// sums would count those cards a second time (operator, 2026-09-30). The popover's open state is LOCAL
// and transient, like NewSessionButton's.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type JSX
} from 'react'
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
import { usePresentValue } from '../../hooks/usePresence'
import { LucideIcon } from '../Icon/LucideIcon'
import { Popover } from '../Popover/Popover'
import { LeavingContext, leavingProps } from '../Presence/leaving'
import { workspaceTintClass } from '../WorkspaceTint/workspaceTint'
import styles from './WorkspaceSwitcher.module.css'

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
  const activeName = active?.name ?? 'Workspace'
  const activeTotal = totals[activeId] ?? 0
  const here = counts[activeId] ?? 0
  const activeWorking = workingCounts[activeId] ?? 0
  const activeGrey = greyCount(activeTotal, activeWorking, here)
  const sumOthers = (byWorkspace: Record<string, number>): number =>
    Object.entries(byWorkspace).reduce(
      (total, [id, count]) => (id === activeId ? total : total + count),
      0
    )
  const elsewhereCards = sumOthers(totals)
  const elsewhere = sumOthers(counts)
  const elsewhereWorking = sumOthers(workingCounts)
  const elsewhereGrey = greyCount(elsewhereCards, elsewhereWorking, elsewhere)

  // Overlay motion (spec 2026-10-04 §5). The rows are FROZEN while the menu fades out: a pick
  // switches the active workspace within the exit, and the fading list would redraw with the new
  // "other workspaces". `present` (not `open`) tucks the tab, so the tab comes back only once the
  // menu is gone.
  const rows = useMemo(
    () => ({ others: workspaces.filter((w) => w.id !== activeId), totals, counts, workingCounts }),
    [workspaces, activeId, totals, counts, workingCounts]
  )
  const menu = usePresentValue(open ? rows : null)
  const listed = menu.value
  const present = listed !== null

  const label =
    describeCounts(activeName, activeTotal, activeWorking, here) +
    (elsewhereCards > 0
      ? `; ${plural(elsewhereCards, 'session', 'sessions')} in other workspaces` +
        (elsewhere > 0 ? `, ${plural(elsewhere, 'needs', 'need')} you` : '')
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
      // main actually confirmed the switch. `setActiveWorkspace` reports an IPC failure itself (a toast) and
      // resolves false, so a RESOLVED promise is not proof the switch happened. Reconciling unconditionally would point the focused view at a workspace the
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
        data-glass="control"
        className={`${styles.switcher} ${workspaceTintClass(active?.color ?? 'slate')}`}
        data-testid="workspace-switcher"
        data-tone={active?.color ?? 'slate'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <LucideIcon name="layers" />
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
      {elsewhereCards > 0 && (
        // Not its own Tab-key stop: the button's aria-label already reads these counts, and a
        // click here does exactly what the button does.
        <span
          className={styles.tab}
          data-testid="workspace-elsewhere-tab"
          data-glass="control"
          aria-hidden="true"
          // Tucked behind the button while the menu lists the same cards row by row.
          data-tucked={present ? '' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          {/* Grey, blue, yellow — the button's order, summed over every OTHER workspace. */}
          {elsewhereGrey !== null && (
            <span className={styles.count} data-testid="workspace-elsewhere-count">
              {elsewhereGrey}
            </span>
          )}
          {elsewhereWorking > 0 && (
            <span className={styles.working} data-testid="workspace-elsewhere-working">
              {elsewhereWorking}
            </span>
          )}
          {elsewhere > 0 && (
            <span className={styles.badge} data-testid="workspace-elsewhere-badge">
              {elsewhere}
            </span>
          )}
        </span>
      )}
      {listed !== null && (
        <LeavingContext value={menu.leaving}>
          <div
            className={styles.menuWrap}
            // Only a drawn tab tucks; with none the menu has nothing to wait for (2026-10-05).
            data-after-tuck={elsewhereCards > 0 ? '' : undefined}
            {...leavingProps(menu.leaving)}
          >
            <Popover.Surface role="menu" onKeyDown={handleMenuKeyDown}>
              {/* The OTHER workspaces only: the button already names the active one, and listing it
                again read as a duplicate (operator, 2026-09-28). */}
              {listed.others.map((w) => {
                const total = listed.totals[w.id] ?? 0
                const needsYou = listed.counts[w.id] ?? 0
                const working = listed.workingCounts[w.id] ?? 0
                const grey = greyCount(total, working, needsYou)
                return (
                  <Popover.Item
                    key={w.id}
                    role="menuitem"
                    tone={w.color}
                    testId={`workspace-row-${w.id}`}
                    aria-label={describeCounts(w.name, total, working, needsYou)}
                    onClick={() => pick(w.id)}
                  >
                    <span className={styles.rowName}>{w.name}</span>
                    {/* Grey, blue, yellow — the button's order, so the pills read the same everywhere. */}
                    <Popover.ItemEnd>
                      {grey !== null && (
                        <span
                          className={styles.rowCount}
                          data-testid={`workspace-row-count-${w.id}`}
                        >
                          {grey}
                        </span>
                      )}
                      {working > 0 && (
                        <span
                          className={styles.working}
                          data-testid={`workspace-row-working-${w.id}`}
                        >
                          {working}
                        </span>
                      )}
                      {needsYou > 0 && (
                        <span className={styles.badge} data-testid={`workspace-row-needs-${w.id}`}>
                          {needsYou}
                        </span>
                      )}
                    </Popover.ItemEnd>
                  </Popover.Item>
                )
              })}
              {listed.others.length > 0 && <Popover.Divider />}
              <Popover.QuietItem
                role="menuitem"
                testId="workspace-manage"
                onClick={() => {
                  setOpen(false)
                  onManage()
                }}
              >
                Manage workspaces…
              </Popover.QuietItem>
            </Popover.Surface>
          </div>
        </LeavingContext>
      )}
    </div>
  )
}
