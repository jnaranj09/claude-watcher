// Memory — one episode, read-only (addendum D30, PICK look 4): what a session did, written by
// extraction only. A Pane, no submit and no `Save`, in the Memory form's own order: `Title` and
// `Body` as read-only text (they wrap in full and keep their line breaks), the action row
// `[Mark stale | Mark active]` and, while a Past sessions record with the episode's origin session
// id is listed, `[Past sessions]`; then `Ended` and the lines every item shows (MemoryItemParts).
// The footer is `Delete` only: the operator deletes, through the same path as an item's form. No
// pin (an episode is never injected in full) and no History (nothing edits it).
// `Past sessions` closes this dialog and opens the Sessions dialog on Past with that record
// selected (`openSessionsDialog`'s target). A `/clear` episode has no record, so no button.
import { useEffect, type JSX } from 'react'
import type { MemoryItem } from '../../../../shared/schemas/memory'
import { PAST_SESSIONS_TERMS } from '../../copy/terms'
import { boardStore } from '../../stores/boardStore'
import {
  loadPastSessions,
  selectPastSessions,
  usePastSessions
} from '../../stores/pastSessionsStore'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { MEMORY_COPY } from './memoryCopy'
import { MemoryItemDelete, MemoryOriginLines, MemoryStateButton } from './MemoryItemParts'
import styles from './MemoryDialog.module.css'

export interface EpisodeFormProps {
  item: Extract<MemoryItem, { kind: 'episode' }>
  onDeleted: () => void
  /** Main took a change that is not a delete (the state): read the list and the item again. */
  onChanged: () => void
}

export function EpisodeForm({ item, onDeleted, onChanged }: EpisodeFormProps): JSX.Element {
  const { actions } = useManageDialogContext()
  // The history is read where it is shown; read it here too, so the button knows the record. A
  // failed read logs its code and leaves the button out (the record cannot be opened anyway).
  useEffect(() => {
    void loadPastSessions()
  }, [])
  const sessionId = item.origin.sessionId
  const listed = usePastSessions(selectPastSessions).some((s) => s.id === sessionId)

  function openRecord(): void {
    if (sessionId === null) return
    actions.close()
    boardStore.getState().openSessionsDialog('past', { pastSessionId: sessionId })
  }

  return (
    <ManageDialog.Pane testId="memory-episode">
      <ManageDialog.Label>{MEMORY_COPY.title}</ManageDialog.Label>
      <p className={`${styles.value} ${styles.text}`} data-testid="memory-episode-title">
        {item.title}
      </p>
      <ManageDialog.Label>{MEMORY_COPY.body}</ManageDialog.Label>
      <p className={`${styles.value} ${styles.text}`} data-testid="memory-episode-body">
        {item.body}
      </p>

      <div className={styles.actions}>
        <MemoryStateButton item={item} onChanged={onChanged} />
        {listed && (
          <ManageDialog.GhostButton testId="memory-episode-past" size="sm" onClick={openRecord}>
            {PAST_SESSIONS_TERMS.label}
          </ManageDialog.GhostButton>
        )}
      </div>

      <ManageDialog.Label>{MEMORY_COPY.ended}</ManageDialog.Label>
      <p className={styles.value}>{new Date(item.endedAt).toLocaleString()}</p>
      <MemoryOriginLines item={item} />

      <ManageDialog.Footer>
        <MemoryItemDelete item={item} onDeleted={onDeleted} />
      </ManageDialog.Footer>
    </ManageDialog.Pane>
  )
}
