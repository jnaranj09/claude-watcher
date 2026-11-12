// Memory — one item's form (spec 2026-11-11 memory §8, mockup option B): `Key` + `Value` (a
// specific) or `Title` + `Body` (a fact), `Check`, explicit `Save`. An open item adds the action
// row `[History] [Mark stale | Mark active]`, then what main stamped, read-only: `Basis`,
// `Last seen`, `Origin session` (with `Session deleted`), `Folder`, `Tags`, `Workspace`; the
// footer is `[Delete] [Save]`. The pin is on the row, never here (owner). A New form adds a
// `Global` switch: off, it is saved in the scope's workspace. Keyed by the item, so a selection
// change remounts it with a fresh draft, and a read of the same item (main's push) keeps the draft.
import { useId, useState, type FormEvent, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  MemoryCreateSchema,
  MemoryEditSchema,
  type MemoryItem
} from '../../../../shared/schemas/memory'
import { HISTORY_TERMS, MEMORY_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { useFlash } from '../../hooks/useFlash'
import { selectTags, tagsForIds, useTags } from '../../stores/tagsStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Switch } from '../Switch/Switch'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TextArea } from '../TextArea/TextArea'
import { TextInput } from '../TextInput/TextInput'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { FIELD_HINT, MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import styles from './MemoryDialog.module.css'

export interface MemoryFormProps {
  kind: MemoryItem['kind']
  /** Null: the New form. */
  item: MemoryItem | null
  /** The scope's workspace: where a new item lives unless `Global` is on. */
  workspaceId: string
  onSaved: (saved: MemoryItem) => void
  onDeleted: () => void
  /** Main took a change that is not a save (the state): read the list and the item again. */
  onChanged: () => void
  onHistory: () => void
}

function headOf(item: MemoryItem): string {
  return item.kind === 'specific' ? item.key : item.title
}

function textOf(item: MemoryItem): string {
  return item.kind === 'specific' ? item.value : item.body
}

export function MemoryForm({
  kind,
  item,
  workspaceId,
  onSaved,
  onDeleted,
  onChanged,
  onHistory
}: MemoryFormProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const tags = useTags(selectTags)
  const globalId = useId()
  const [head, setHead] = useState(item === null ? '' : headOf(item))
  const [text, setText] = useState(item === null ? '' : textOf(item))
  const [check, setCheck] = useState(item?.check ?? '')
  const [global, setGlobal] = useState(false)
  const [marked, flashMarked] = useFlash<true>()

  const checkValue = check.trim() === '' ? null : check
  const draftText =
    kind === 'specific' ? { kind, key: head, value: text } : { kind, title: head, body: text }
  // The request main would get, checked by main's own schema: Save is greyed until it passes.
  const create =
    item === null
      ? MemoryCreateSchema.safeParse({
          workspaceId: global ? null : workspaceId,
          text: draftText,
          check: checkValue
        })
      : null
  const edit =
    item === null
      ? null
      : MemoryEditSchema.safeParse({ id: item.id, text: draftText, check: checkValue })
  const issuePath = (create ?? edit)?.error?.issues[0]?.path ?? []
  // A text field's issue sits under `text` (`['text', 'value']`); `check` sits at the top.
  const field = String(issuePath[0] === 'text' ? issuePath[1] : issuePath[0])
  const valid = (create ?? edit)?.success === true

  const dirty =
    item === null
      ? head.trim() !== '' || text.trim() !== '' || checkValue !== null
      : head.trim() !== headOf(item) ||
        text.trim() !== textOf(item) ||
        (checkValue?.trim() ?? null) !== item.check

  const save = useAsyncAction(async (): Promise<void> => {
    try {
      if (create?.success === true) onSaved(await window.memory.create(create.data))
      else if (edit?.success === true) onSaved(await window.memory.edit(edit.data))
    } catch (err) {
      console.warn('[claude-watcher][memory] code=memory_save_failed')
      // The draft stays as typed: a refused write is undone in main, never here.
      actions.setError(memoryErrorCopy(err, MEMORY_COPY.saveFailed))
    }
  })

  const remove = useAsyncAction(async (): Promise<void> => {
    if (item === null) return
    try {
      await window.memory.remove(item.id)
      onDeleted()
    } catch (err) {
      console.warn('[claude-watcher][memory] code=memory_delete_failed')
      actions.setError(memoryErrorCopy(err, MEMORY_COPY.deleteFailed))
    }
  })

  const changeState = useAsyncAction(async (): Promise<void> => {
    if (item === null) return
    const next = item.state === 'active' ? 'stale' : 'active'
    actions.setError(null)
    try {
      await window.memory.setState(item.id, next)
      flashMarked(true)
      onChanged()
    } catch (err) {
      console.warn('[claude-watcher][memory] code=memory_state_failed')
      actions.setError(memoryErrorCopy(err, MEMORY_COPY.saveFailed))
    }
  })

  const canSave = dirty && valid && !save.busy

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    if (canSave) void save.run()
  }

  /** Every edit clears the last result (R26). */
  function edited(set: (next: string) => void): (next: string) => void {
    return (next) => {
      set(next)
      actions.setError(null)
    }
  }

  const headId = kind === 'specific' ? 'memory-key' : 'memory-title'
  const textId = kind === 'specific' ? 'memory-value' : 'memory-body'
  const hint = dirty && !valid ? (FIELD_HINT[field] ?? null) : null
  const shownTags = item === null ? [] : tagsForIds(tags, item.meta.tagIds)
  const deleted = item !== null && item.originDeletedAt !== null
  const originName = item?.meta.sessionName ?? null
  // Where the item lives (Past sessions' form: the name in its tint; a gone one is an orphan).
  const owner = workspaces.find((w) => w.id === item?.workspaceId)

  return (
    <ManageDialog.Form testId="memory-form" onSubmit={submit}>
      <ManageDialog.Label htmlFor={headId}>
        {kind === 'specific' ? MEMORY_COPY.key : MEMORY_COPY.title}
      </ManageDialog.Label>
      <TextInput id={headId} testId={headId} value={head} onChange={edited(setHead)} />

      <ManageDialog.Label htmlFor={textId}>
        {kind === 'specific' ? MEMORY_COPY.value : MEMORY_COPY.body}
      </ManageDialog.Label>
      {kind === 'specific' ? (
        <TextInput id={textId} testId={textId} value={text} onChange={edited(setText)} />
      ) : (
        <TextArea id={textId} testId={textId} rows={5} value={text} onChange={edited(setText)} />
      )}

      <ManageDialog.Label htmlFor="memory-check">{MEMORY_COPY.check}</ManageDialog.Label>
      <TextInput
        id="memory-check"
        testId="memory-check"
        placeholder={MEMORY_COPY.checkPlaceholder}
        value={check}
        onChange={edited(setCheck)}
      />
      {/* Why Save is greyed, once the operator has edited something (design.md): by the fields. */}
      {hint !== null && <ManageDialog.Hint testId="memory-hint">{hint}</ManageDialog.Hint>}

      {item === null ? (
        <span className={styles.switchRow}>
          <Switch id={globalId} testId="memory-global" checked={global} onChange={setGlobal} />
          <label className={styles.switchLabel} htmlFor={globalId}>
            {MEMORY_COPY.global}
          </label>
        </span>
      ) : (
        <>
          <div className={styles.actions}>
            <ManageDialog.GhostButton testId="memory-history-open" size="sm" onClick={onHistory}>
              {HISTORY_TERMS.history}
            </ManageDialog.GhostButton>
            <ManageDialog.GhostButton
              testId="memory-state"
              size="sm"
              busy={changeState.busy}
              feedback={MEMORY_COPY.marked}
              feedbackShown={marked !== null}
              onClick={() => void changeState.run()}
            >
              {item.state === 'active' ? MEMORY_COPY.markStale : MEMORY_COPY.markActive}
            </ManageDialog.GhostButton>
          </div>

          <ManageDialog.Label>{MEMORY_COPY.basis}</ManageDialog.Label>
          <p className={styles.value} data-testid="memory-form-basis">
            {item.basis}
          </p>
          <ManageDialog.Label>{MEMORY_COPY.lastSeen}</ManageDialog.Label>
          <p className={styles.value}>{new Date(item.lastSeenAt).toLocaleString()}</p>
          {(originName !== null || deleted) && (
            <>
              <ManageDialog.Label>{MEMORY_COPY.originSession}</ManageDialog.Label>
              <p className={styles.valueRow} data-testid="memory-form-origin">
                {originName !== null && (
                  <span className={styles.value} title={originName}>
                    {originName}
                  </span>
                )}
                {deleted && <WorkspaceLabel name={MEMORY_TERMS.sessionDeleted} tone="orphan" />}
              </p>
            </>
          )}
          {item.meta.folder !== null && (
            <>
              <ManageDialog.Label>{MEMORY_COPY.folder}</ManageDialog.Label>
              <p
                className={`${styles.value} ${styles.mono}`}
                data-testid="memory-form-folder"
                title={item.meta.folder}
              >
                {item.meta.folder}
              </p>
            </>
          )}
          {shownTags.length > 0 && (
            <>
              <ManageDialog.Label>{MEMORY_COPY.tags}</ManageDialog.Label>
              <div className={styles.valueRow}>
                <TagChipRow tags={shownTags} testId="memory-form-tags" />
              </div>
            </>
          )}
          <ManageDialog.Label>{MEMORY_COPY.workspace}</ManageDialog.Label>
          <p className={styles.valueRow} data-testid="memory-form-workspace">
            {item.workspaceId === null ? (
              <WorkspaceLabel name={MEMORY_COPY.global} tone="global" />
            ) : (
              <WorkspaceLabel
                name={owner?.name ?? '(no workspace)'}
                tone={owner?.color ?? 'orphan'}
              />
            )}
          </p>
        </>
      )}

      <ManageDialog.Footer>
        {item !== null && (
          <ManageDialog.Delete
            testId="memory-delete"
            busy={remove.busy}
            onConfirm={() => void remove.run()}
          />
        )}
        <ManageDialog.Save testId="memory-save" disabled={!canSave} busy={save.busy} />
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}
