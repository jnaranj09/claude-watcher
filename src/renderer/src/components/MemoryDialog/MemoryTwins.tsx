// Memory — `Same value as` in an open specific's form: the other active specifics main found with
// the same exact value in the same workspace and folder (`memoryTwins.ts`). One ghost button per
// twin (its key; a click opens it), its age beside it, `<n> more` past the five main names, then
// the hint. It follows `GoalsDialog/SessionOpenButton.tsx`: a ghost `sm` Button per linked thing,
// `title` saying what a click does. Nothing here changes an item: the operator marks one stale.
import type { JSX } from 'react'
import type { MemoryTwin } from '../../../../shared/ipc/contract'
import { LIST_TERMS } from '../../copy/terms'
import { Button } from '../Button/Button'
import { ManageDialog } from '../ManageDialog/ManageDialog'
import { relativeEnded } from '../PastSessionsDialog/pastSessionsView'
import { MEMORY_COPY } from './memoryCopy'
import styles from './MemoryDialog.module.css'

export function MemoryTwins({
  twins,
  more,
  now,
  onOpen
}: {
  twins: readonly MemoryTwin[]
  more: number
  now: () => number
  onOpen: (id: string) => void
}): JSX.Element | null {
  if (twins.length === 0) return null
  return (
    <>
      <ManageDialog.Label>{MEMORY_COPY.sameValueAs}</ManageDialog.Label>
      <div className={styles.twins} data-testid="memory-twins">
        {twins.map((twin) => (
          <span key={twin.id} className={styles.rowMeta}>
            <Button
              variant="ghost"
              size="sm"
              testId={`memory-twin-${twin.id}`}
              title={MEMORY_COPY.openTwin(twin.key)}
              onClick={() => onOpen(twin.id)}
            >
              <span className={styles.twinKey}>{twin.key}</span>
            </Button>
            <span className={styles.rowAge}>{relativeEnded(twin.updatedAt, now())}</span>
          </span>
        ))}
        {more > 0 && <span className={styles.rowMeta}>{LIST_TERMS.more(more)}</span>}
      </div>
      <ManageDialog.Hint testId="memory-twins-hint">{MEMORY_COPY.sameValueHint}</ManageDialog.Hint>
    </>
  )
}
