// `Link session` on an open Goals sheet task (spec 2026-10-29 task ↔ session link): a menu of the
// live sessions of the task's workspace not linked to it yet, Needs you first. Picking one makes
// the same link the session rail's `Link task` makes; the session's rail shows the task at once.
// The task's row then shows the session (TaskSessionLine), so a landed link needs no toast; a
// refused one is the sheet's error toast. Claude in that session is not told (accepted gap).
// The menu is portaled to the body and placed by `useAnchoredPlacement`, like `Select`: drawn
// inside the form it would be cut by the scroll body and its end fade (the last row's menu).
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Task } from '../../../../shared/schemas/goal'
import { GOAL_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { goalErrorCopy } from '../../lib/goalCopy'
import { selectSessionsById, useBoard } from '../../stores/boardStore'
import { linkTask } from '../../stores/goalsStore'
import { Button } from '../Button/Button'
import { useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Popover } from '../Popover/Popover'
import { useAnchoredPlacement } from '../Popover/useAnchoredPlacement'
import { Presence } from '../Presence/Presence'
import { leavingProps } from '../Presence/leaving'
import { StatusDot } from '../StatusDot/StatusDot'
import styles from './GoalsDialog.module.css'
import { linkCandidates } from './taskSessions'

export function LinkSessionMenu({ task }: { task: Task }): JSX.Element {
  const { actions } = useManageDialogContext()
  const candidates = linkCandidates(task, Object.values(useBoard(selectSessionsById)))
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const placement = useAnchoredPlacement(menuOpen, buttonRef, menuRef, 'end')

  // A press anywhere outside the button + menu closes the menu, like every other popover here.
  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node)) return
      if (anchorRef.current?.contains(e.target) === true) return
      if (menuRef.current?.contains(e.target) === true) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuOpen])

  // Escape peels the open menu only; the sheet stays open. Heard on the anchor, so it works with
  // focus on the button too (a pointer open leaves it there); React bubbles the portaled menu's
  // keys here as well.
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>): void => {
    if (e.key !== 'Escape' || !menuOpen) return
    e.stopPropagation()
    setMenuOpen(false)
    buttonRef.current?.focus()
  }

  const link = useAsyncAction(async (sessionId: string): Promise<void> => {
    actions.setError(null)
    setMenuOpen(false)
    try {
      await linkTask(task.id, sessionId)
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.linkTaskFailed))
    }
  })

  return (
    <span className={styles.linkAnchor} ref={anchorRef} onKeyDown={onKeyDown}>
      <Button
        variant="secondary"
        testId={`task-link-${task.id}`}
        aria-label={`${GOAL_TERMS.linkSession} ${task.title}`}
        buttonRef={buttonRef}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        busy={link.busy}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {GOAL_TERMS.linkSession}
      </Button>
      <Presence value={menuOpen || null}>
        {(_, leaving) =>
          createPortal(
            <div
              ref={menuRef}
              className={styles.linkMenuWrap}
              style={placement}
              {...leavingProps(leaving)}
            >
              <Popover.Surface role="menu">
                {candidates.length === 0 ? (
                  <Popover.Note testId={`task-link-none-${task.id}`}>
                    {GOAL_TERMS.noSessionsToLink}
                  </Popover.Note>
                ) : (
                  <Popover.List>
                    {candidates.map((s) => (
                      <Popover.CompactItem
                        key={s.id}
                        role="menuitem"
                        testId={`task-link-pick-${s.id}`}
                        onClick={() => void link.run(s.id)}
                      >
                        <span className={styles.taskSession}>
                          <StatusDot status={s.column} />
                          <span className={styles.taskSessionName} title={s.sessionName}>
                            {s.sessionName}
                          </span>
                        </span>
                      </Popover.CompactItem>
                    ))}
                  </Popover.List>
                )}
              </Popover.Surface>
            </div>,
            document.body
          )
        }
      </Presence>
    </span>
  )
}
