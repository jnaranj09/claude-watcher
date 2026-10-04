// Rules — the Rules PAGE of the Tags dialog (spec §4.4; spec 2026-10-03 C), on ManageDialog: a header scope
// filter (`All rules` · Global · each workspace), a FLAT list and a form. The list IS the run order
// (T-14): rows are never sorted, and ↑ / ↓ in each row's RowActions slot are the only reorder — the
// one row action with no form equivalent (design.md). A broken rule (T-23) carries a marker.
// UX-DR14: App.tsx guards it against the other modals and closes it on the quit guard.
import { useEffect, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Rule } from '../../../../shared/ipc/contract'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { ScopeFilter } from '../ScopeFilter/ScopeFilter'
import {
  filterByScope,
  hasOrphans,
  knownWorkspaceIds,
  scopeOf,
  type ScopeFilterValue
} from '../ScopeFilter/scope'
import {
  moveRule,
  selectBrokenIds,
  selectRules,
  selectRulesLoadFailed,
  useRules
} from '../../stores/rulesStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { RuleForm } from './RuleForm'
import { triggerSummary } from './ruleForm'
import styles from './RulesDialog.module.css'

export function RulesPage({ scope, setScope, pages }: DialogPageProps): JSX.Element {
  const dialog = useManageDialogContext()
  const { closeRef } = dialog.meta
  const rules = useRules(selectRules)
  const loadFailed = useRules(selectRulesLoadFailed)
  const brokenIds = useRules(useShallow(selectBrokenIds))
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const known = knownWorkspaceIds(workspaces)
  const listed = filterByScope(rules, scope, known)
  const broken = new Set(brokenIds)
  const selected = rules.find((r) => r.id === dialog.state.selectedId) ?? null
  const formOpen = dialog.state.creating || selected !== null

  // An aria-modal dialog must take focus on mount: the ✕ is the mount-stable target.
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  function changeScope(next: ScopeFilterValue): void {
    setScope(next)
    // design.md — changing the scope closes whatever was open.
    dialog.actions.select(null)
  }

  /** design.md — a save that moves a row to another scope follows it: a row that vanishes on save
   *  reads as a save that failed. */
  function revealSaved(rule: Rule): void {
    dialog.actions.select(rule.id)
    if (filterByScope([rule], scope, known).length === 0) setScope(scopeOf(rule.workspaceId, known))
    dialog.actions.showSuccess('Rule saved.')
  }

  // Action feedback (spec 2026-09-29 §2.5) — one move at a time: a second press would compute its
  // index from a list main has not answered yet. A refusal says so on the error line, and the next
  // move clears it. ↑ / ↓ move past the neighbouring VISIBLE rule — in a filtered view, the rule the
  // operator sees beside it. `rules:move` takes the FINAL index in the full list.
  const moving = useAsyncAction(async (rule: Rule, step: -1 | 1): Promise<void> => {
    const neighbour = listed[listed.indexOf(rule) + step]
    if (neighbour === undefined) return
    dialog.actions.setError(null)
    try {
      await moveRule(rule.id, rules.indexOf(neighbour))
    } catch {
      dialog.actions.setError('Could not move the rule.')
    }
  })

  const emptyCopy = loadFailed
    ? 'Could not load rules.'
    : rules.length === 0
      ? 'No rules yet'
      : 'No rules in this workspace'

  return (
    <>
      <ManageDialog.Header>
        <ScopeFilter
          value={scope}
          workspaces={workspaces}
          showOrphans={hasOrphans(rules, known)}
          onChange={changeScope}
          allLabel="All rules"
          testId="rule-scope-filter"
          ariaLabel="Filter rules by workspace"
        />
      </ManageDialog.Header>
      <ManageDialog.Columns>
        {pages}
        <ManageDialog.List size="wide">
          <ManageDialog.Rows>
            {listed.map((r, i) => {
              const isFirst = i === 0
              const isLast = i === listed.length - 1
              return (
                <ManageDialog.Row
                  key={r.id}
                  id={r.id}
                  testId="rule-row"
                  selectTestId={`rule-select-${r.id}`}
                >
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{r.name}</span>
                    <span className={styles.rowSummary}>{triggerSummary(r.trigger)}</span>
                  </span>
                  {broken.has(r.id) && (
                    <span
                      className={styles.broken}
                      data-testid={`rule-broken-${r.id}`}
                      title="This rule never runs: a tag or template it uses is gone or out of its scope, or its pattern is not a valid regular expression."
                    >
                      <span className="sr-only"> (broken)</span>
                    </span>
                  )}
                  {/* R-uniform (controller ruling): render the slot — and BOTH controls in it —
                        on every row once there is more than one, so the 56px slot is identical on
                        every row and the rail never goes ragged (design.md). A control that can
                        never act at an end is DISABLED, not omitted: omitting it would leave one
                        row with a single, off-centre button instead of the same two-button shape
                        everywhere. Each carries an sr-only label saying why nothing happens.
                        R-keyboard: the slot is revealed by `:focus-within` (ManageDialog.module.css),
                        so Shift+Tab from row B's select button skips row A's ↑/↓ (hidden until row A
                        itself has focus) and lands on row A's select button — real, but not
                        something jsdom's layout-free DOM can observe (no CSS, no Tab-key traversal).
                        RulesDialog.test.tsx checks the part a test CAN see instead: the buttons are
                        real, un-hidden, non-`tabIndex=-1` DOM nodes once the row is on screen. */}
                  {listed.length > 1 && (
                    <ManageDialog.RowActions>
                      <ManageDialog.GhostButton
                        testId={`rule-up-${r.id}`}
                        onClick={() => void moving.run(r, -1)}
                        busy={moving.busy}
                        disabled={isFirst}
                        size="xs"
                        icon
                      >
                        <span aria-hidden="true">↑</span>
                        <span className="sr-only">
                          {isFirst ? 'Already first' : `Move ${r.name} up`}
                        </span>
                      </ManageDialog.GhostButton>
                      <ManageDialog.GhostButton
                        testId={`rule-down-${r.id}`}
                        onClick={() => void moving.run(r, 1)}
                        busy={moving.busy}
                        disabled={isLast}
                        size="xs"
                        icon
                      >
                        <span aria-hidden="true">↓</span>
                        <span className="sr-only">
                          {isLast ? 'Already last' : `Move ${r.name} down`}
                        </span>
                      </ManageDialog.GhostButton>
                    </ManageDialog.RowActions>
                  )}
                </ManageDialog.Row>
              )
            })}
            {listed.length === 0 && (
              <p className={styles.empty} data-testid="rules-empty">
                {emptyCopy}
              </p>
            )}
          </ManageDialog.Rows>
          <ManageDialog.New testId="rule-new" />
        </ManageDialog.List>
        {formOpen ? (
          <RuleForm key={selected?.id ?? 'new'} rule={selected} onSaved={revealSaved} />
        ) : (
          <ManageDialog.Placeholder testId="rule-placeholder">
            Select a rule on the left, or create a new one.
          </ManageDialog.Placeholder>
        )}
      </ManageDialog.Columns>
      <ManageDialog.Message testId="rule-error" />
    </>
  )
}
