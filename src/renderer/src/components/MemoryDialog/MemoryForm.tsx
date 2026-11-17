// Memory — one item's form (spec 2026-11-11 memory §8, mockup option B): `Key` + `Value` (a
// specific) or `Title` + `Body` (a fact), `Check`, explicit `Save`. An open item adds the action
// row `[History] [Mark stale | Mark active]`, plus `[Open source]` when extraction kept where it
// came from, then `Same value as` when main found other specifics with the same value
// (`sameValue`, MemoryTwins), then what main stamped, read-only: `Basis`, `Last seen`, then the lines it shares with
// an episode (MemoryItemParts: `Origin session` with `Session deleted`, `Workspace`; `Folder` and
// `Tags` are fields here, below), and, while `Open source` is on, the stored quote in History's frame (PICK look 3;
// nothing reads the transcript at view time, addendum D31). The footer is `[Delete] [Save]`. The
// pin is on the row, never here (owner). A New form adds a `Global` switch: off, it is saved in the
// scope's workspace. Keyed by the item, so a selection change remounts it with a fresh draft, and a
// read of the same item (main's push) keeps the draft.
//
// Where the item is placed (spec 2026-11-14 memory context index §8): after `Check`, `Folder` (a
// Select of the folders the dialog knows, `No folder` first), `Goal` (the workspace's goals, `No
// goal` first; not rendered for a global item or under `Global`), `Tags` (the shared
// `TagRowField`: the chips of the picked tags, the tag button and its picker), then one hint. On an
// open item these replace the read-only `Folder` and `Tags` lines. A New form starts from the rail's filters
// (`draftFromFilters`) and sends the whole context; an open item sends only what changed
// (`contextPatch`), so a stored goal or tag the form cannot draw is neither sent nor dropped.
// `Global` on clears the goal and the tags a global item cannot hold (`rescopeContext`).
import { useEffect, useId, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import {
  MemoryCreateSchema,
  MemoryEditSchema,
  type MemoryItem
} from '../../../../shared/schemas/memory'
import { HISTORY_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { folderName, parentPath } from '../../lib/filterCopy'
import { Button } from '../Button/Button'
import filterChipStyles from '../FilterChips/FilterChips.module.css'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Select, type SelectOption } from '../Select/Select'
import { Switch } from '../Switch/Switch'
import { TagRowField } from '../TagPicker/TagRowField'
import { TextArea } from '../TextArea/TextArea'
import { TextInput } from '../TextInput/TextInput'
import {
  contextPatch,
  NO_FOLDER,
  NO_GOAL,
  rescopeContext,
  type ContextDraft
} from './memoryContext'
import { FIELD_HINT, MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import { MemoryItemDelete, MemoryOriginLines, MemoryStateButton } from './MemoryItemParts'
import styles from './MemoryDialog.module.css'

/** What the form's `Folder`, `Goal` and `Tags` offer, and where a New form starts. */
export interface MemoryFormContext {
  /** The folders the dialog knows (`offeredFolders`), the open item's own first. */
  folders: readonly string[]
  /** The workspace's goals. */
  goals: readonly { id: string; name: string }[]
  /** The tags the scope can see (`railTags`): global and the workspace's own. */
  tags: readonly Tag[]
  /** A New form's start (`draftFromFilters`). */
  start: ContextDraft
}

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
  /** `Same value as` (MemoryTwins) for an open specific; null for the New form. */
  sameValue: ReactNode
  context: MemoryFormContext
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
  onHistory,
  sameValue,
  context
}: MemoryFormProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const globalId = useId()
  const quoteId = useId()
  const [head, setHead] = useState(item === null ? '' : headOf(item))
  const [text, setText] = useState(item === null ? '' : textOf(item))
  const [check, setCheck] = useState(item?.check ?? '')
  const [global, setGlobal] = useState(false)
  // The tags a global item may hold; under `Global` (or on a global item) only these are offered.
  const scopeGlobal = item === null ? global : item.workspaceId === null
  const offeredTags = scopeGlobal
    ? context.tags.filter((t) => t.workspaceId === null)
    : context.tags
  const drawnTagIds = new Set(offeredTags.map((t) => t.id))
  const [place, setPlace] = useState<ContextDraft>(() =>
    item === null
      ? context.start
      : {
          folder: item.meta.folder,
          goalId: item.meta.goalId,
          tagIds: item.meta.tagIds.filter((id) => drawnTagIds.has(id))
        }
  )
  const patch = item === null ? null : contextPatch(item, place, drawnTagIds)
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
          check: checkValue,
          context: place
        })
      : null
  const edit =
    item === null
      ? null
      : MemoryEditSchema.safeParse({
          id: item.id,
          text: draftText,
          check: checkValue,
          context: patch
        })
  const issuePath = (create ?? edit)?.error?.issues[0]?.path ?? []
  // A text field's issue sits under `text` (`['text', 'value']`); `check` sits at the top.
  const field = String(issuePath[0] === 'text' ? issuePath[1] : issuePath[0])
  const valid = (create ?? edit)?.success === true

  const dirty =
    item === null
      ? head.trim() !== '' || text.trim() !== '' || checkValue !== null
      : head.trim() !== headOf(item) ||
        text.trim() !== textOf(item) ||
        (checkValue?.trim() ?? null) !== item.check ||
        patch !== null

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

  function placed(change: Partial<ContextDraft>): void {
    setPlace((p) => ({ ...p, ...change }))
    actions.setError(null)
  }

  function switchGlobal(next: boolean): void {
    setGlobal(next)
    // design.md: a scope change in a form resets what the new scope can't see.
    if (next) {
      const globalIds = new Set(context.tags.filter((t) => t.workspaceId === null).map((t) => t.id))
      setPlace((p) => rescopeContext(p, globalIds))
    }
    actions.setError(null)
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

      <ContextFields
        context={context}
        place={place}
        offeredTags={offeredTags}
        showGoal={!scopeGlobal}
        onPlace={placed}
      />

      {item === null ? (
        <span className={styles.switchRow}>
          <Switch id={globalId} testId="memory-global" checked={global} onChange={switchGlobal} />
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

          {sameValue}
          <ManageDialog.Label>{MEMORY_COPY.basis}</ManageDialog.Label>
          <p className={styles.value} data-testid="memory-form-basis">
            {item.basis}
          </p>
          <ManageDialog.Label>{MEMORY_COPY.lastSeen}</ManageDialog.Label>
          <p className={styles.value}>{new Date(item.lastSeenAt).toLocaleString()}</p>
          <MemoryOriginLines item={item} omitPlace />
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

/** A folder option: its last path part, then its parent path, quieter (the Folder filter's rows);
 *  the whole path is its `title`. */
function folderOption(path: string): SelectOption<string> {
  const parent = parentPath(path)
  return {
    value: path,
    label: path,
    display: (
      <span title={path}>
        <span className={filterChipStyles.folderName}>{folderName(path)}</span>
        {parent !== '' && <span className={filterChipStyles.path}>{` ${parent}`}</span>}
      </span>
    )
  }
}

/** `Folder`, `Goal` and `Tags`, then their one hint. */
function ContextFields({
  context,
  place,
  offeredTags,
  showGoal,
  onPlace
}: {
  context: MemoryFormContext
  place: ContextDraft
  offeredTags: readonly Tag[]
  showGoal: boolean
  onPlace: (change: Partial<ContextDraft>) => void
}): JSX.Element {
  const folderValue = place.folder ?? NO_FOLDER
  // A stored goal that is gone shows `No goal` (and is kept unless another is picked).
  const goalValue = context.goals.some((g) => g.id === place.goalId)
    ? (place.goalId ?? NO_GOAL)
    : NO_GOAL
  const pickedTags = offeredTags.filter((t) => place.tagIds.includes(t.id))

  return (
    <>
      <ManageDialog.Label>{MEMORY_COPY.folder}</ManageDialog.Label>
      <Select
        value={folderValue}
        options={[
          { value: NO_FOLDER, label: MEMORY_COPY.noFolder },
          ...context.folders.map(folderOption)
        ]}
        onChange={(next) => {
          if (next !== folderValue) onPlace({ folder: next === NO_FOLDER ? null : next })
        }}
        ariaLabel={MEMORY_COPY.folder}
        testId="memory-folder"
      />
      {showGoal && (
        <>
          <ManageDialog.Label>{MEMORY_COPY.goal}</ManageDialog.Label>
          <Select
            value={goalValue}
            options={[
              { value: NO_GOAL, label: MEMORY_COPY.noGoal },
              ...context.goals.map((g) => ({ value: g.id, label: g.name }))
            ]}
            onChange={(next) => {
              if (next !== goalValue) onPlace({ goalId: next === NO_GOAL ? null : next })
            }}
            ariaLabel={MEMORY_COPY.goal}
            testId="memory-goal"
          />
        </>
      )}
      <ManageDialog.Label>{MEMORY_COPY.tags}</ManageDialog.Label>
      <TagRowField
        shownTags={pickedTags}
        offeredTags={offeredTags}
        selectedIds={pickedTags.map((t) => t.id)}
        onChange={(tagIds) => onPlace({ tagIds })}
        label={MEMORY_COPY.tags}
        className={styles.valueRow}
        testIds={{
          field: 'memory-tags',
          chips: 'memory-tags-chips',
          button: 'memory-tags-button',
          picker: 'memory-tag-picker'
        }}
      />
      <ManageDialog.Hint testId="memory-context-hint">{MEMORY_COPY.contextHint}</ManageDialog.Hint>
    </>
  )
}
