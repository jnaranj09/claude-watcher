// The storage notice (UX-06, UX-07). A store file that could not be read started EMPTY, and a
// change that could not be written is gone after a restart; before this the only trace was a
// console `code=`. It sits under the header until dismissed. Problems only ever grow within a run,
// so a dismiss hides the ones seen so far and a NEW problem brings the notice back.
//
// Main decides the problems; the copy lives in lib/storageHealthCopy.ts.

import { useState, type JSX } from 'react'
import type { StorageHealth } from '../../../../shared/ipc/contract'
import { storageProblemMessage } from '../../lib/storageHealthCopy'
import { Button } from '../Button/Button'
import styles from './StorageNotice.module.css'

export function StorageNotice({ health }: { health: StorageHealth | null }): JSX.Element | null {
  const [dismissed, setDismissed] = useState(0)
  const problems = health?.problems ?? []
  if (problems.length <= dismissed) return null
  return (
    <div className={styles.notice} role="alert" data-testid="storage-notice">
      <ul className={styles.lines}>
        {problems.map((p) => (
          <li key={`${p.store}:${p.code}`}>{storageProblemMessage(p)}</li>
        ))}
      </ul>
      <Button
        variant="ghost"
        size="xs"
        icon
        testId="storage-notice-dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => setDismissed(problems.length)}
      >
        ✕
      </Button>
    </div>
  )
}
