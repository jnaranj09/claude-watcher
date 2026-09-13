// Rules — the rule form: name, workspace, WHEN (the trigger), ONLY IF (the conditions, all must
// hold) and THEN (the actions), then [Delete] [Save]. Keyed by the selected id in RulesDialog, so a
// selection change remounts it with a fresh draft (TemplateForm's rule). Every control is a Select
// or a TextInput (design.md). A tag or template dropdown offers only what the rule's scope can see
// (T-11): a global rule, global items; a workspace rule, global + its own — via the SHARED
// `inRuleScope` predicate (ruleRefs.ts), never re-derived inline here.
import { useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Rule, RuleAction, RuleCondition, RuleTrigger } from '../../../../shared/ipc/contract'
import { RULE_NAME_MAX_LENGTH, RULE_PATTERN_MAX_LENGTH } from '../../../../shared/schemas/rule'
import { inRuleScope } from '../../../../shared/rules/ruleRefs'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Select } from '../Select/Select'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceDot } from '../WorkspaceDot/WorkspaceDot'
import { removeRule, saveRule } from '../../stores/rulesStore'
import { selectTags, useTags } from '../../stores/tagsStore'
import { selectTemplates, useTemplates } from '../../stores/templatesStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import {
  ACTION_CHOICES,
  COLUMN_CHOICES,
  CONDITION_CHOICES,
  FROM_TO_CHOICES,
  MINUTES_CHOICES,
  MODE_CHOICES,
  TRIGGER_CHOICES,
  conditionFor,
  emptyDraft,
  isDraftDirty,
  minutesFrom,
  ruleErrorMessage,
  toDraft,
  triggerFor,
  validateDraft,
  type RuleDraft
} from './ruleForm'
import styles from './RulesDialog.module.css'

/** The Workspace dropdown's stand-in for "no workspace" — a word, never '' (it becomes a testid). */
const GLOBAL_SCOPE = 'global'

interface Option {
  value: string
  label: string
}

/** T-11 — a global rule (workspaceId null) sees global items only; a workspace rule sees global +
 *  its own. The per-item visibility check IS `ruleRefs.ts#inRuleScope` — the same predicate main
 *  and the tags store use — this only turns it into the option list a <Select> wants. */
function visibleInRuleScope<T extends { workspaceId: string | null }>(
  items: readonly T[],
  ruleWorkspaceId: string | null
): T[] {
  return items.filter((item) => inRuleScope(ruleWorkspaceId, item.workspaceId))
}

export interface RuleFormProps {
  rule: Rule | null
  onSaved: (saved: Rule) => void
}

export function RuleForm({ rule, onSaved }: RuleFormProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const allTags = useTags(selectTags)
  const allTemplates = useTemplates(selectTemplates)
  const [draft, setDraft] = useState<RuleDraft>(() =>
    rule === null ? emptyDraft() : toDraft(rule)
  )
  const [busy, setBusy] = useState(false)

  const tagOptions: Option[] = visibleInRuleScope(allTags, draft.workspaceId).map((t) => ({
    value: t.id,
    label: t.name
  }))
  const templateOptions: Option[] = visibleInRuleScope(allTemplates, draft.workspaceId).map(
    (t) => ({
      value: t.id,
      label: t.name
    })
  )
  const validation = validateDraft(draft, rule?.id)
  const dirty = isDraftDirty(draft, rule)
  const canSave = validation.ok && dirty && !busy

  function patch(next: Partial<RuleDraft>): void {
    setDraft((d) => ({ ...d, ...next }))
    actions.setError(null)
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!validation.ok || !dirty) return
    setBusy(true)
    try {
      onSaved(await saveRule(validation.request))
    } catch (err) {
      actions.setError(ruleErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (rule === null) return
    setBusy(true)
    try {
      await removeRule(rule.id)
      // Back to the New form; the form remounts, so there is no busy flag left to reset.
      actions.select(null)
    } catch (err) {
      actions.setError(ruleErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <ManageDialog.Form testId="rule-form" onSubmit={(e) => void submit(e)}>
      <ManageDialog.Label htmlFor="rule-name">Name</ManageDialog.Label>
      <TextInput
        id="rule-name"
        testId="rule-name"
        maxLength={RULE_NAME_MAX_LENGTH}
        value={draft.name}
        onChange={(name) => patch({ name })}
      />

      <ManageDialog.Label>Workspace</ManageDialog.Label>
      <Select
        value={draft.workspaceId ?? GLOBAL_SCOPE}
        options={[
          { value: GLOBAL_SCOPE, label: 'Global', adornment: <WorkspaceDot tone="global" /> },
          ...workspaces.map((w) => ({
            value: w.id,
            label: w.name,
            adornment: <WorkspaceDot tone={w.color} />
          }))
        ]}
        onChange={(next) => patch({ workspaceId: next === GLOBAL_SCOPE ? null : next })}
        ariaLabel="Workspace"
        testId="rule-scope"
      />

      <ManageDialog.Label>When</ManageDialog.Label>
      <div className={styles.clause}>
        <Select
          value={draft.trigger.kind}
          options={TRIGGER_CHOICES}
          onChange={(kind) => patch({ trigger: triggerFor(kind) })}
          ariaLabel="When the rule runs"
          testId="rule-trigger"
        />
        <TriggerFields trigger={draft.trigger} onChange={(trigger) => patch({ trigger })} />
      </div>

      <ManageDialog.Label>Only if (all of these)</ManageDialog.Label>
      {draft.conditions.length === 0 && <p className={styles.note}>Always — no conditions.</p>}
      {draft.conditions.map((condition, i) => (
        <ConditionRow
          key={i}
          index={i}
          condition={condition}
          tagOptions={tagOptions}
          templateOptions={templateOptions}
          onChange={(next) =>
            patch({ conditions: draft.conditions.map((c, j) => (j === i ? next : c)) })
          }
          onRemove={() => patch({ conditions: draft.conditions.filter((_, j) => j !== i) })}
        />
      ))}
      <ManageDialog.GhostButton
        testId="rule-add-condition"
        onClick={() =>
          patch({
            conditions: [
              ...draft.conditions,
              conditionFor('has-tag', tagOptions[0]?.value ?? '', templateOptions[0]?.value ?? '')
            ]
          })
        }
      >
        + Add condition
      </ManageDialog.GhostButton>

      <ManageDialog.Label>Then</ManageDialog.Label>
      {draft.actions.map((action, i) => (
        <ActionRow
          key={i}
          index={i}
          action={action}
          tagOptions={tagOptions}
          onChange={(next) => patch({ actions: draft.actions.map((a, j) => (j === i ? next : a)) })}
          onRemove={() => patch({ actions: draft.actions.filter((_, j) => j !== i) })}
        />
      ))}
      <ManageDialog.GhostButton
        testId="rule-add-action"
        onClick={() =>
          patch({
            actions: [...draft.actions, { kind: 'add-tag', tagId: tagOptions[0]?.value ?? '' }]
          })
        }
      >
        + Add action
      </ManageDialog.GhostButton>

      {/* Why Save is disabled, once the operator has edited something. The error line (below the
          columns) stays reserved for main's refusals. */}
      {dirty && !validation.ok && (
        <ManageDialog.Hint testId="rule-hint">{validation.error}</ManageDialog.Hint>
      )}

      <ManageDialog.Footer>
        {rule !== null && (
          <ManageDialog.Delete
            testId="rule-delete"
            disabled={busy}
            onConfirm={() => void confirmDelete()}
          />
        )}
        <ManageDialog.Save testId="rule-save" disabled={!canSave} />
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}

function TriggerFields(props: {
  trigger: RuleTrigger
  onChange: (trigger: RuleTrigger) => void
}): JSX.Element | null {
  const { trigger, onChange } = props
  if (trigger.kind === 'launched') return null
  if (trigger.kind === 'column-change') {
    return (
      <>
        <Select
          value={trigger.from}
          options={FROM_TO_CHOICES}
          onChange={(from) => onChange({ ...trigger, from })}
          ariaLabel="From column"
          testId="rule-from"
        />
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
        <Select
          value={trigger.to}
          options={FROM_TO_CHOICES}
          onChange={(to) => onChange({ ...trigger, to })}
          ariaLabel="To column"
          testId="rule-to"
        />
      </>
    )
  }
  return (
    <>
      <Select
        value={trigger.column}
        options={COLUMN_CHOICES}
        onChange={(column) => onChange({ ...trigger, column })}
        ariaLabel="Column"
        testId="rule-column"
      />
      <Select
        value={String(trigger.minutes)}
        options={MINUTES_CHOICES}
        onChange={(value) => onChange({ ...trigger, minutes: minutesFrom(value) })}
        ariaLabel="For how long"
        testId="rule-minutes"
      />
    </>
  )
}

function ConditionRow(props: {
  index: number
  condition: RuleCondition
  tagOptions: Option[]
  templateOptions: Option[]
  onChange: (condition: RuleCondition) => void
  onRemove: () => void
}): JSX.Element {
  const { index, condition, tagOptions, templateOptions, onChange, onRemove } = props
  const n = index + 1
  return (
    <div className={styles.clause} data-testid={`rule-condition-${index}`}>
      <Select
        value={condition.kind}
        options={CONDITION_CHOICES}
        onChange={(kind) =>
          onChange(conditionFor(kind, tagOptions[0]?.value ?? '', templateOptions[0]?.value ?? ''))
        }
        ariaLabel={`Condition ${n}`}
        testId={`rule-condition-kind-${index}`}
      />
      {(condition.kind === 'has-tag' || condition.kind === 'lacks-tag') && (
        <Select
          value={condition.tagId}
          options={tagOptions}
          onChange={(tagId) => onChange({ ...condition, tagId })}
          ariaLabel={`Condition ${n} tag`}
          testId={`rule-condition-tag-${index}`}
        />
      )}
      {condition.kind === 'template' && (
        <Select
          value={condition.templateId}
          options={templateOptions}
          onChange={(templateId) => onChange({ ...condition, templateId })}
          ariaLabel={`Condition ${n} template`}
          testId={`rule-condition-template-${index}`}
        />
      )}
      {(condition.kind === 'folder' || condition.kind === 'name') && (
        <>
          <Select
            value={condition.mode}
            options={MODE_CHOICES}
            onChange={(mode) => onChange({ ...condition, mode })}
            ariaLabel={`Condition ${n} match`}
            testId={`rule-condition-mode-${index}`}
          />
          <TextInput
            testId={`rule-condition-pattern-${index}`}
            ariaLabel={`Condition ${n} pattern`}
            maxLength={RULE_PATTERN_MAX_LENGTH}
            placeholder={condition.kind === 'folder' ? '/prod' : 'api'}
            value={condition.pattern}
            onChange={(pattern) => onChange({ ...condition, pattern })}
          />
        </>
      )}
      <ManageDialog.GhostButton testId={`rule-condition-remove-${index}`} onClick={onRemove}>
        Remove
      </ManageDialog.GhostButton>
    </div>
  )
}

function ActionRow(props: {
  index: number
  action: RuleAction
  tagOptions: Option[]
  onChange: (action: RuleAction) => void
  onRemove: () => void
}): JSX.Element {
  const { index, action, tagOptions, onChange, onRemove } = props
  const n = index + 1
  return (
    <div className={styles.clause} data-testid={`rule-action-${index}`}>
      <Select
        value={action.kind}
        options={ACTION_CHOICES}
        onChange={(kind) => onChange({ ...action, kind })}
        ariaLabel={`Action ${n}`}
        testId={`rule-action-kind-${index}`}
      />
      <Select
        value={action.tagId}
        options={tagOptions}
        onChange={(tagId) => onChange({ ...action, tagId })}
        ariaLabel={`Action ${n} tag`}
        testId={`rule-action-tag-${index}`}
      />
      <ManageDialog.GhostButton testId={`rule-action-remove-${index}`} onClick={onRemove}>
        Remove
      </ManageDialog.GhostButton>
    </div>
  )
}
