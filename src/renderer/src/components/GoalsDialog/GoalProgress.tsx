// A goal's progress: a thin bar and `done/total`. Derived from its tasks, never stored; a goal with
// no tasks is an empty bar and `0/0`, never 100% (spec 2026-10-19 "Assumed"). Drawn from existing
// tokens only; the app had no bar before this one.
import type { JSX } from 'react'
import styles from './GoalsDialog.module.css'

export function GoalProgress({ done, total }: { done: number; total: number }): JSX.Element {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <span className={styles.progress}>
      <span
        className={styles.track}
        role="progressbar"
        aria-label="Tasks done"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span className={styles.fill} style={{ inlineSize: `${percent}%` }} />
      </span>
      <span className={styles.count} data-testid="goal-progress-text">
        {done}/{total}
      </span>
    </span>
  )
}
