// Memory — one item's form (spec 2026-11-11 memory §8, mockup option B): `Key` + `Value` (a
// specific) or `Title` + `Body` (a fact), `Check`, explicit `Save`. An open item adds the action
// row `[History] [Mark stale | Mark active]`, plus `[Open source]` when extraction kept where it
// came from, then what main stamped, read-only: `Basis`, `Last seen`, then the lines it shares with
// an episode (MemoryItemParts: `Origin session` with `Session deleted`, `Folder`, `Tags`,
// `Workspace`), and, while `Open source` is on, the stored quote in History's frame (PICK look 3;
// nothing reads the transcript at view time, addendum D31). The footer is `[Delete] [Save]`. The
// pin is on the row, never here (owner). A New form adds a `Global` switch: off, it is saved in the
// scope's workspace. Keyed by the item, so a selection change remounts it with a fresh draft, and a
// read of the same item (main's push) keeps the draft.
import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import {
  MemoryCreateSchema,
  MemoryEditSchema,
  type MemoryItem
} from '../../../../shared/schemas/memory'
import { HISTORY_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { Button } from '../Button/Button'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Switch } from '../Switch/Switch'
import { TextArea } from '../TextArea/TextArea'
import { TextInput } from '../TextInput/TextInput'
import { FIELD_HINT, MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import { MemoryItemDelete, MemoryOriginLines, MemoryStateButton } from './MemoryItemParts'
import styles from './MemoryDialog.module.css'

export interface MemoryFormProps {
  kind: 'specific' | 'fact'
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
  const globalId = useId()
  const quoteId = useId()
  const [head, setHead] = useState(item === null ? '' : headOf(item))
  const [text, setText] = useState(item === null ? '' : textOf(item))
  const [check, setCheck] = useState(item?.check ?? '')
  const [global, setGlobal] = useState(false)
  // `Open source`: the quote opens under the last read-only line, below the fold at the default
  // window, so opening it scrolls it into view (PICK look 3).
  const [sourceOpen, setSourceOpen] = useState(false)
  const quoteRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (sourceOpen) quoteRef.current?.scrollIntoView({ block: 'nearest' })
  }, [sourceOpen])

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
  const source = item?.source ?? null

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
            <MemoryStateButton item={item} onChanged={onChanged} />
            {source !== null && (
              <Button
                variant="secondary"
                size="sm"
                lit={sourceOpen}
                aria-expanded={sourceOpen}
                aria-controls={quoteId}
                testId="memory-source-open"
                onClick={() => setSourceOpen((open) => !open)}
              >
                {MEMORY_COPY.openSource}
              </Button>
            )}
          </div>

          <ManageDialog.Label>{MEMORY_COPY.basis}</ManageDialog.Label>
          <p className={styles.value} data-testid="memory-form-basis">
            {item.basis}
          </p>
          <ManageDialog.Label>{MEMORY_COPY.lastSeen}</ManageDialog.Label>
          <p className={styles.value}>{new Date(item.lastSeenAt).toLocaleString()}</p>
          <MemoryOriginLines item={item} />
          {source !== null && sourceOpen && (
            <p id={quoteId} ref={quoteRef} className={styles.quote} data-testid="memory-source">
              {source.quote}
            </p>
          )}
        </>
      )}

      <ManageDialog.Footer>
        {item !== null && <MemoryItemDelete item={item} onDeleted={onDeleted} />}
        <ManageDialog.Save testId="memory-save" disabled={!canSave} busy={save.busy} />
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}
