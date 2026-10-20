// A planner's proposal, under the goal's tasks in the Goals sheet (spec 2026-10-19 "Plan with
// Claude"): one row per session (`Session <n>`, the planner's note, its tasks), a `Select` per task
// to move it to another row, a ✕ to drop a row, the `Claude can mark tasks done` switch (on, not
// kept) and `Accept` / `Reject`. Moves, not drag (the spec bans drag). Nothing starts until Accept.
//
// The edit is a local draft of main's proposal: the parent keys this panel by the proposal, so a
// new `propose_split` starts a fresh draft. A task closed or deleted since the proposal is left out
// of the rows (and of Accept); a row left with no task is dropped. Main checks the edited groups
// again (the same checks as `Start session`, and only tasks the planner proposed), so the renderer
// sends ids and intents only.
import { useId, useState, type JSX } from 'react'
import type { Proposal, Task } from '../../../../shared/schemas/goal'
import { GOAL_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { goalErrorCopy, goalStartErrorCopy } from '../../lib/goalCopy'
import { decideProposal } from '../../stores/goalsStore'
import { Button } from '../Button/Button'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Select } from '../Select/Select'
import { Switch } from '../Switch/Switch'
import styles from './GoalsDialog.module.css'

export interface ProposalPanelProps {
  proposal: Proposal
  /** The goal's tasks, as main has them now. */
  tasks: readonly Task[]
}

interface Row {
  note: string
  taskIds: string[]
}

/** The draft's rows that still mean something: only open tasks of the goal, no empty row. */
function liveRows(rows: readonly Row[], open: ReadonlyMap<string, Task>): Row[] {
  return rows
    .map((row) => ({ note: row.note, taskIds: row.taskIds.filter((id) => open.has(id)) }))
    .filter((row) => row.taskIds.length > 0)
}

export function ProposalPanel({ proposal, tasks }: ProposalPanelProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const [draft, setDraft] = useState<Row[]>(() =>
    proposal.groups.map((g) => ({ note: g.note, taskIds: [...g.taskIds] }))
  )
  const [markDone, setMarkDone] = useState(true)
  const switchId = useId()
  const open = new Map(tasks.filter((t) => t.status === 'open').map((t) => [t.id, t]))
  const rows = liveRows(draft, open)
  const { plannerSessionId } = proposal

  function move(taskId: string, to: number): void {
    setDraft(() => {
      const next = rows.map((row) => ({
        ...row,
        taskIds: row.taskIds.filter((id) => id !== taskId)
      }))
      next[to]?.taskIds.push(taskId)
      return next.filter((row) => row.taskIds.length > 0)
    })
  }

  function removeRow(index: number): void {
    setDraft(() => rows.filter((_, i) => i !== index))
  }

  // A refusal keeps the panel and the edit, so the operator can fix it and press again.
  const accept = useAsyncAction(async (): Promise<void> => {
    if (rows.length === 0) return
    actions.setError(null)
    try {
      const started = await decideProposal({
        plannerSessionId,
        decision: 'accept',
        groups: rows.map((row) => ({ taskIds: row.taskIds })),
        markDone
      })
      actions.showSuccess(started === 1 ? GOAL_TERMS.sessionStarted : GOAL_TERMS.sessionsStarted)
    } catch (err) {
      const copy = goalStartErrorCopy(err)
      if (copy !== null) actions.setError(copy)
    }
  })
  const reject = useAsyncAction(async (): Promise<void> => {
    actions.setError(null)
    try {
      await decideProposal({ plannerSessionId, decision: 'reject' })
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.rejectFailed))
    }
  })

  const options = rows.map((_, i) => ({ value: String(i), label: GOAL_TERMS.proposalRow(i + 1) }))

  return (
    <section className={styles.proposal} data-testid={`proposal-${plannerSessionId}`}>
      <ManageDialog.Label>{GOAL_TERMS.proposal}</ManageDialog.Label>
      <ol className={styles.proposalRows}>
        {rows.map((row, i) => (
          <li key={row.taskIds[0]} className={styles.proposalRow} data-testid={`proposal-row-${i}`}>
            <div className={styles.proposalRowHead}>
              <span className={styles.proposalRowName}>{GOAL_TERMS.proposalRow(i + 1)}</span>
              <span className={styles.proposalNote} title={row.note}>
                {row.note}
              </span>
              <Button
                variant="ghost"
                size="xs"
                icon
                testId={`proposal-remove-${i}`}
                aria-label={GOAL_TERMS.removeRow(i + 1)}
                onClick={() => removeRow(i)}
              >
                ✕
              </Button>
            </div>
            <ul className={styles.taskRows}>
              {row.taskIds.map((id) => {
                const title = open.get(id)?.title ?? ''
                return (
                  <li key={id} className={styles.proposalTask}>
                    <span className={styles.proposalTaskTitle} title={title}>
                      {title}
                    </span>
                    <Select
                      variant="inline"
                      align="end"
                      value={String(i)}
                      options={options}
                      onChange={(next) => move(id, Number(next))}
                      ariaLabel={GOAL_TERMS.moveTask(title)}
                      testId={`proposal-move-${id}`}
                    />
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>
      <div className={styles.proposalActions}>
        <span className={styles.startSwitch}>
          <Switch
            id={switchId}
            testId="proposal-mark-done"
            checked={markDone}
            onChange={setMarkDone}
          />
          <label className={styles.startSwitchLabel} htmlFor={switchId}>
            {GOAL_TERMS.markDone}
          </label>
        </span>
        <ManageDialog.GhostButton
          testId="proposal-reject"
          busy={reject.busy}
          onClick={() => void reject.run()}
        >
          {GOAL_TERMS.reject}
        </ManageDialog.GhostButton>
        <ManageDialog.GhostButton
          testId="proposal-accept"
          busy={accept.busy}
          disabled={rows.length === 0}
          onClick={() => void accept.run()}
        >
          {GOAL_TERMS.accept}
        </ManageDialog.GhostButton>
      </div>
    </section>
  )
}
