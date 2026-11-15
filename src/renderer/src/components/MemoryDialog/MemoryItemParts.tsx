// Memory — the parts an item's form (MemoryForm: a specific or a fact) and an episode's read-only
// pane (EpisodeForm) share, so the two never drift: `Mark stale` / `Mark active` with its `✓ Saved`,
// the footer's `Delete` → `Confirm delete`, and the read-only lines of where the item came from
// (`Origin session` with `Session deleted`, `Folder`, `Tags`, `Workspace`; an item's form edits
// `Folder` and `Tags` as fields and leaves them out here). Every write's refusal is
// the dialog's error toast, mapped from its code (memoryErrorCopy), never the message.
import type { JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MemoryItem } from '../../../../shared/schemas/memory'
import { MEMORY_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { useFlash } from '../../hooks/useFlash'
import { selectTags, tagsForIds, useTags } from '../../stores/tagsStore'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { TagChipRow } from '../TagChip/TagChipRow'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import { MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import styles from './MemoryDialog.module.css'

/** `Mark stale` on an active item, `Mark active` on a stale one; says `✓ Saved` in place. */
export function MemoryStateButton({
  item,
  onChanged
}: {
  item: MemoryItem
  /** Main took the change: read the list and the item again. */
  onChanged: () => void
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const [marked, flashMarked] = useFlash<true>()
  const changeState = useAsyncAction(async (): Promise<void> => {
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
  return (
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
  )
}

/** The footer's `Delete` → `Confirm delete`. The operator deletes; a refused delete stays listed
 *  (main undid it) and says why. */
export function MemoryItemDelete({
  item,
  onDeleted
}: {
  item: MemoryItem
  onDeleted: () => void
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const remove = useAsyncAction(async (): Promise<void> => {
    try {
      await window.memory.remove(item.id)
      onDeleted()
    } catch (err) {
      console.warn('[claude-watcher][memory] code=memory_delete_failed')
      actions.setError(memoryErrorCopy(err, MEMORY_COPY.deleteFailed))
    }
  })
  return (
    <ManageDialog.Delete
      testId="memory-delete"
      busy={remove.busy}
      onConfirm={() => void remove.run()}
    />
  )
}

/** Where the item came from, read-only: `Origin session` (with `Session deleted`), `Folder`, `Tags`
 *  (only with tags), `Workspace` (the name in its tint; a gone one is an orphan). `omitPlace`
 *  leaves out `Folder` and `Tags`: a specific's or fact's form edits them as fields (spec
 *  2026-11-14 memory context index §8); an episode keeps them read-only. */
export function MemoryOriginLines({
  item,
  omitPlace = false
}: {
  item: MemoryItem
  omitPlace?: boolean
}): JSX.Element {
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const tags = useTags(selectTags)
  const shownTags = tagsForIds(tags, item.meta.tagIds)
  const deleted = item.originDeletedAt !== null
  const originName = item.meta.sessionName
  const owner = workspaces.find((w) => w.id === item.workspaceId)
  return (
    <>
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
      {!omitPlace && item.meta.folder !== null && (
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
      {!omitPlace && shownTags.length > 0 && (
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
          <WorkspaceLabel name={owner?.name ?? '(no workspace)'} tone={owner?.color ?? 'orphan'} />
        )}
      </p>
    </>
  )
}
