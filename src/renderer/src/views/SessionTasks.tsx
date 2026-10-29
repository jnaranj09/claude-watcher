// The focused view's task panel (spec 2026-10-19 Decision E): the tasks linked to the session in
// view, grouped by goal; each group's bar counts only this session's tasks in it (not the whole
// goal, not every daily task of the workspace); `Done` / `Undo` on each, `Link task` to add
// another, ✕ to unlink. Pure renderer view of goalsStore; every change goes to main and comes back as the view.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { GOAL_TERMS } from '../copy/terms'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { goalErrorCopy } from '../lib/goalCopy'
import {
  linkTask,
  progressOf,
  setTaskStatus,
  unlinkTask,
  useGoals,
  type GoalsState
} from '../stores/goalsStore'
import type { Task } from '../../../shared/schemas/goal'
import { Button } from '../components/Button/Button'
import { Callout } from '../components/Callout/Callout'
import { GoalProgress } from '../components/GoalProgress/GoalProgress'
import { Popover } from '../components/Popover/Popover'
import { Presence } from '../components/Presence/Presence'
import { leavingProps } from '../components/Presence/leaving'
import { TaskRow } from '../components/TaskRow/TaskRow'
import styles from './SessionTasks.module.css'

interface Group {
  key: string
  name: string
  /** Linked here: what the rows show and what the bar counts. */
  linked: Task[]
}

/** The linked tasks by goal, in the order the goals were made; loose ones last. */
function groupsFor(s: Pick<GoalsState, 'goals' | 'tasks'>, sessionId: string): Group[] {
  const linked = s.tasks.filter((t) => t.sessionIds.includes(sessionId))
  const groups: Group[] = []
  for (const g of s.goals) {
    const mine = linked.filter((t) => t.goalId === g.id)
    if (mine.length > 0) {
      groups.push({ key: g.id, name: g.name, linked: mine })
    }
  }
  // A task whose goal is missing is shown as loose rather than dropped.
  const known = new Set(s.goals.map((g) => g.id))
  const loose = linked.filter((t) => t.goalId === null || !known.has(t.goalId))
  if (loose.length > 0) {
    groups.push({ key: 'loose', name: GOAL_TERMS.daily, linked: loose })
  }
  return groups
}

export function SessionTasks({
  sessionId,
  workspaceId,
  width
}: {
  sessionId: string
  workspaceId: string
  /** Its width in px (the focused view's, changed by the drag line beside it). */
  width: number
}): JSX.Element {
  // The store's own arrays (stable references): groups are built here, not in the selector, so the
  // shallow compare never sees fresh nested objects.
  const { goals, tasks } = useGoals((s) => ({ goals: s.goals, tasks: s.tasks }))
  const groups = groupsFor({ goals, tasks }, sessionId)
  const candidates = useGoals((s) =>
    s.tasks.filter(
      (t) =>
        t.workspaceId === workspaceId && t.status === 'open' && !t.sessionIds.includes(sessionId)
    )
  )
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // A press anywhere outside the button + menu closes the menu, like every other popover here.
  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && anchorRef.current?.contains(e.target) === true) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuOpen])

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    setMenuOpen(false)
    buttonRef.current?.focus()
  }

  const tick = useAsyncAction(async (task: Task, done: boolean): Promise<void> => {
    setError(null)
    try {
      await setTaskStatus(task.id, done ? 'done' : 'open')
    } catch (err) {
      setError(goalErrorCopy(err, GOAL_TERMS.saveTaskFailed))
    }
  })
  const link = useAsyncAction(async (task: Task): Promise<void> => {
    setError(null)
    setMenuOpen(false)
    try {
      await linkTask(task.id, sessionId)
    } catch (err) {
      setError(goalErrorCopy(err, GOAL_TERMS.linkTaskFailed))
    }
  })
  const unlink = useAsyncAction(async (task: Task): Promise<void> => {
    setError(null)
    try {
      await unlinkTask(task.id, sessionId)
    } catch (err) {
      setError(goalErrorCopy(err, GOAL_TERMS.unlinkTaskFailed))
    }
  })

  return (
    <aside
      className={styles.panel}
      style={{ width }}
      data-testid="session-tasks"
      aria-label={GOAL_TERMS.tasks}
    >
      <div className={styles.head} data-testid="session-tasks-head">
        <span className={styles.heading}>{GOAL_TERMS.tasks}</span>
        <div className={styles.anchor} ref={anchorRef}>
          <Button
            variant="secondary"
            size="sm"
            testId="session-tasks-link"
            buttonRef={buttonRef}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            busy={link.busy}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {GOAL_TERMS.linkTask}
          </Button>
          <Presence value={menuOpen || null}>
            {(_, leaving) => (
              <div className={styles.menuWrap} {...leavingProps(leaving)}>
                <Popover.Surface role="menu" onKeyDown={onMenuKeyDown}>
                  {candidates.length === 0 ? (
                    <Popover.Note testId="session-tasks-nothing-to-link">
                      {GOAL_TERMS.nothingToLink}
                    </Popover.Note>
                  ) : (
                    <Popover.List>
                      {candidates.map((t) => (
                        <Popover.CompactItem
                          key={t.id}
                          role="menuitem"
                          testId={`session-tasks-pick-${t.id}`}
                          onClick={() => void link.run(t)}
                        >
                          {t.title}
                        </Popover.CompactItem>
                      ))}
                    </Popover.List>
                  )}
                </Popover.Surface>
              </div>
            )}
          </Presence>
        </div>
      </div>
      {error !== null && <Callout tone="danger" title={error} testId="session-tasks-error" />}
      <div className={styles.body}>
        {groups.length === 0 ? (
          <p className={styles.empty}>{GOAL_TERMS.noneLinked}</p>
        ) : (
          groups.map((g) => {
            const { done, total } = progressOf(g.linked)
            return (
              <section key={g.key} className={styles.group} data-testid={`session-tasks-${g.key}`}>
                <span className={styles.goalName} title={g.name}>
                  {g.name}
                </span>
                <GoalProgress name={g.name} done={done} total={total} />
                <ul className={styles.rows}>
                  {g.linked.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={(d) => void tick.run(task, d)}
                      busy={tick.busy}
                      trailing={
                        <Button
                          variant="ghost"
                          icon
                          busy={unlink.busy}
                          testId={`session-tasks-unlink-${task.id}`}
                          aria-label={`Unlink ${task.title}`}
                          onClick={() => void unlink.run(task)}
                        >
                          ✕
                        </Button>
                      }
                    />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </aside>
  )
}
