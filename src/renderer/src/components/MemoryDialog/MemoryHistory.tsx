// One memory item's History (spec 2026-11-11 memory §8; Context's History, ContextHistory.tsx, is
// the model): its versions newest first as a radio group (the text, its age, who wrote it), the
// picked one's reason and how it differs from the text now, and `Restore this version`, which arms
// in place (`ManageDialog.Delete`'s two presses). A restore never overwrites: main appends the
// picked text as the newest version. Results are the dialog's toast.
import { useState, type JSX } from 'react'
import type { MemoryItem, MemoryVersion } from '../../../../shared/schemas/memory'
import { HISTORY_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { relativeEnded } from '../PastSessionsDialog/pastSessionsView'
import { Radio } from '../Radio/Radio'
import { MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import styles from './MemoryDialog.module.css'

type Line = { op: 'add' | 'del'; text: string }

const MARK: Record<Line['op'], string> = { add: '+', del: '-' }

/** What restoring `then` changes in `now`: the head and the text that differ, the text now
 *  removed (`-`) and the picked one added (`+`). A whole-text swap, not a line-by-line diff: a
 *  specific's value is one line, and a fact's body is short. */
function changes(now: MemoryVersion, then: MemoryVersion): Line[] {
  const out: Line[] = []
  if (now.head !== then.head)
    out.push({ op: 'del', text: now.head }, { op: 'add', text: then.head })
  if (now.body !== then.body) {
    for (const text of now.body.split('\n')) out.push({ op: 'del', text })
    for (const text of then.body.split('\n')) out.push({ op: 'add', text })
  }
  return out
}

export function MemoryHistory({
  item,
  versions,
  backLabel,
  onBack,
  onRestored,
  now
}: {
  item: MemoryItem
  /** Newest first: `[0]` is the text now. */
  versions: readonly MemoryVersion[]
  /** The page (`Specifics` / `Facts`): the way back names it. */
  backLabel: string
  onBack: () => void
  onRestored: () => void
  now: () => number
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const [picked, setPicked] = useState<number | null>(null)
  const version = picked === null ? undefined : versions[picked]
  const current = versions[0]
  const name = item.kind === 'specific' ? item.key : item.title

  function pick(index: number): void {
    setPicked(index)
    actions.disarm()
    actions.setError(null)
  }

  const restore = useAsyncAction(async (): Promise<void> => {
    if (version === undefined) return
    try {
      await window.memory.restore(item.id, version.at)
      actions.disarm()
      setPicked(null)
      onRestored()
    } catch (err) {
      console.warn('[claude-watcher][memory] code=memory_restore_failed')
      actions.setError(memoryErrorCopy(err, MEMORY_COPY.restoreFailed))
    }
  })

  return (
    <div className={styles.history}>
      <div className={styles.historyHead}>
        <ManageDialog.GhostButton testId="memory-history-back" size="sm" onClick={onBack}>
          <span aria-hidden>←</span> {backLabel}
        </ManageDialog.GhostButton>
        <span className={styles.historyName} title={name}>
          {name}
        </span>
      </div>
      <div className={styles.versions} role="radiogroup" aria-label={HISTORY_TERMS.history}>
        {versions.map((v, index) => {
          const firstLine = v.body.split('\n')[0] ?? ''
          const when = `${relativeEnded(v.at, now())}, ${v.by}`
          return (
            <label key={`${v.at}-${index}`} className={styles.version}>
              <Radio
                name="memory-version"
                value={String(v.at)}
                checked={picked === index}
                onChange={() => pick(index)}
                ariaLabel={`${firstLine} · ${when}`}
                testId="memory-version"
              />
              <span className={styles.versionText} aria-hidden title={v.body}>
                {firstLine}
              </span>
              <span className={styles.versionWhen} aria-hidden>
                · {when}
              </span>
            </label>
          )
        })}
      </div>
      {version === undefined || current === undefined ? (
        <p className={styles.note}>{MEMORY_COPY.pickVersion}</p>
      ) : (
        <>
          {picked === 0 ? (
            <p className={styles.note}>{MEMORY_COPY.currentVersion}</p>
          ) : (
            <pre className={styles.diff} data-testid="memory-diff">
              {changes(current, version).map((l, i) => (
                <span key={i} className={styles.line} data-op={l.op}>
                  {MARK[l.op]}
                  {l.text}
                </span>
              ))}
            </pre>
          )}
          {version.reason !== null && (
            <p className={styles.note}>{MEMORY_COPY.reason(version.reason)}</p>
          )}
          {picked !== 0 && (
            <ManageDialog.Footer>
              <ManageDialog.Delete
                testId="memory-restore"
                label={HISTORY_TERMS.restore}
                confirmLabel={HISTORY_TERMS.confirmRestore}
                busy={restore.busy}
                onConfirm={() => void restore.run()}
              />
            </ManageDialog.Footer>
          )}
        </>
      )}
    </div>
  )
}
