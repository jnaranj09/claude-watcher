// One instruction file's History (spec 2026-10-18 §5): its versions newest first (a radio group:
// one is compared at a time), the diff of the picked one against the file now, and `Restore this
// version`, which arms in place (`ManageDialog.Delete`'s two presses: a restore overwrites the
// file, after main keeps what is there now). Results go to the dialog's one message slot.
import { useEffect, useRef, useState, type JSX } from 'react'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Radio } from '../Radio/Radio'
import { relativeEnded } from '../PastSessionsDialog/pastSessionsView'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import type { DiffLine, FileHistoryListResult } from '../../../../shared/ipc/contract'
import { CONTEXT_COPY, contextErrorCopy, sizeLabel } from './contextCopy'
import styles from './ContextDialog.module.css'

const MARK: Record<DiffLine['op'], string> = { same: ' ', add: '+', del: '-' }

export function ContextHistory({
  sessionId,
  fileIndex,
  name,
  onBack
}: {
  sessionId: string
  fileIndex: number
  name: string
  onBack: () => void
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const [history, setHistory] = useState<FileHistoryListResult | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  // The versions' age is read once, when the history opens (it is not a clock).
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let live = true
    window.context
      .listHistory(sessionId, fileIndex)
      .then((h) => {
        if (live) setHistory(h)
      })
      .catch((err: unknown) => {
        if (live) actions.setError(contextErrorCopy('list', err, name))
      })
    return () => {
      live = false
    }
  }, [sessionId, fileIndex, name, actions])

  // The pick a diff answer belongs to: an answer for an earlier pick that lands late is dropped,
  // or its diff would show under the version Restore would write.
  const pickRef = useRef<string | null>(null)
  function pick(versionId: string): void {
    pickRef.current = versionId
    setPicked(versionId)
    setLines(null)
    actions.disarm()
    actions.setError(null)
    window.context
      .diff(versionId)
      .then((d) => {
        if (pickRef.current === versionId) setLines(d.lines)
      })
      .catch((err: unknown) => {
        if (pickRef.current === versionId) actions.setError(contextErrorCopy('diff', err, name))
      })
  }

  const restore = useAsyncAction(async (): Promise<void> => {
    if (picked === null) return
    try {
      const { fileName } = await window.context.restore(picked)
      actions.disarm()
      actions.showSuccess(CONTEXT_COPY.restored(fileName))
    } catch (err) {
      actions.setError(contextErrorCopy('restore', err, name))
    }
  })

  return (
    <div className={styles.history} data-testid="context-history">
      <div className={styles.historyHead}>
        <ManageDialog.GhostButton testId="context-history-back" size="sm" onClick={onBack}>
          <span aria-hidden>←</span> Instructions
        </ManageDialog.GhostButton>
        <span className={styles.name} title={name}>
          {name}
        </span>
      </div>
      {history === null ? null : history.tooLarge ? (
        <p className={styles.empty}>{CONTEXT_COPY.tooLargeForHistory}</p>
      ) : history.versions.length === 0 ? (
        <p className={styles.empty}>{CONTEXT_COPY.noVersions}</p>
      ) : (
        <>
          <div className={styles.versions} role="radiogroup" aria-label={CONTEXT_COPY.history}>
            {history.versions.map((v) => {
              const label = `${relativeEnded(v.seenAt, now)}, ${sizeLabel(v.size)}`
              return (
                <label key={v.id} className={styles.version}>
                  <Radio
                    name="context-version"
                    value={v.id}
                    checked={picked === v.id}
                    onChange={() => pick(v.id)}
                    ariaLabel={label}
                    testId="context-version"
                  />
                  <span aria-hidden>{label}</span>
                </label>
              )
            })}
          </div>
          {picked === null ? (
            <p className={styles.empty}>{CONTEXT_COPY.pickVersion}</p>
          ) : (
            <>
              {lines !== null && (
                <pre className={styles.diff} data-testid="context-diff">
                  {lines.map((l, i) => (
                    <span
                      key={i}
                      className={styles.line}
                      data-op={l.op}
                      data-testid="context-diff-line"
                    >
                      {MARK[l.op]}
                      {l.text}
                    </span>
                  ))}
                </pre>
              )}
              <ManageDialog.Footer>
                <ManageDialog.Delete
                  testId="context-restore"
                  label={CONTEXT_COPY.restore}
                  confirmLabel={CONTEXT_COPY.confirmRestore}
                  busy={restore.busy}
                  onConfirm={() => void restore.run()}
                />
              </ManageDialog.Footer>
            </>
          )}
        </>
      )}
    </div>
  )
}
