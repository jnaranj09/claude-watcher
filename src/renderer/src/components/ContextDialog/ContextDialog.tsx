// Context (spec 2026-10-18 §5): what a session's claude loaded, from its bridge mod report, on
// the Settings pattern — one ManageDialog, the categories as rail rows, a Pane on the right. The
// dialog follows a TERMINAL (boardStore.contextDialogTerminalId), so a `/clear` that re-keys the
// session keeps it open on the new id. Main pushes `session-setup:changed` when a report lands;
// the dialog asks again. The renderer never holds a path it sends back: a file is its index.
import { useEffect, useState, type JSX } from 'react'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { Callout } from '../Callout/Callout'
import { useBoard } from '../../stores/boardStore'
import type { ModReport, SessionSetupState } from '../../../../shared/ipc/contract'
import type { MemoryActivity } from '../../../../shared/schemas/memory'
import { CONTEXT_TERMS } from '../../copy/terms'
import {
  CONTEXT_CATEGORIES,
  CONTEXT_COPY,
  FIRST_CONTEXT_CATEGORY,
  UNAVAILABLE_COPY,
  type ContextCategoryId
} from './contextCopy'
import { ContextPage } from './contextPages'
import styles from './ContextDialog.module.css'

const isCategory = (id: string | null): id is ContextCategoryId =>
  CONTEXT_CATEGORIES.some((c) => c.id === id)

/** Each category's total tokens, where the report has them. */
function categoryTokens(
  report: ModReport,
  id: ContextCategoryId,
  memory: MemoryActivity | null
): number | null {
  const sum = (rows: readonly { tokens: number }[]): number =>
    rows.reduce((total, r) => total + r.tokens, 0)
  switch (id) {
    case 'instructions':
      return sum(report.memoryFiles)
    case 'skills':
      return report.skills === null ? null : sum(report.skills)
    case 'agents':
      return sum(report.agents)
    case 'mcp':
      return sum(report.mcpServers)
    case 'commands':
      return report.slashCommands?.tokens ?? null
    case 'memory':
      return memory?.injected?.tokens ?? null
    case 'hooks':
    case 'plugins':
      return null
  }
}

export function ContextDialog({
  terminalId,
  onClose
}: {
  terminalId: string
  onClose: () => void
}): JSX.Element {
  const sessionId = useBoard(
    (s) => Object.entries(s.terminalIdBySessionId).find(([, t]) => t === terminalId)?.[0] ?? null
  )
  const [setup, setSetup] = useState<SessionSetupState | null>(null)
  // The last read failed: a standing notice, so it sits in the right column, never on the
  // dialog's error state (spec 2026-10-26). The next read that answers clears it.
  const [loadError, setLoadError] = useState<string | null>(null)
  // The terminal was bound to a session once: a later null means its card left the board (the
  // session ended), not a launch still waiting for its id.
  const [bound, setBound] = useState(false)
  if (sessionId !== null && !bound) setBound(true)
  const ended = bound && sessionId === null
  const dialog = useManageDialog({
    title: CONTEXT_TERMS.label,
    testIdPrefix: 'context',
    onClose,
    initialSelectedId: FIRST_CONTEXT_CATEGORY
  })

  useEffect(() => {
    if (sessionId === null) return
    let live = true
    const load = (): void => {
      window.context
        .getSetup(sessionId)
        .then((next) => {
          if (!live) return
          setSetup(next)
          setLoadError(null)
        })
        .catch(() => {
          if (live) setLoadError(CONTEXT_COPY.loadFailed)
        })
    }
    load()
    const off = window.context.onSetupChanged((id) => {
      if (id === sessionId) load()
    })
    return () => {
      live = false
      off()
    }
  }, [sessionId])

  // What memory gave, pulled and saved for this session. Main answers even while memory is off;
  // a failed read is a notice on the Memory page (its own copy, never the error's text).
  const [memory, setMemory] = useState<{ activity: MemoryActivity; at: number } | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  useEffect(() => {
    if (sessionId === null) return
    let live = true
    const load = (): void => {
      window.memory
        .activity(sessionId)
        .then((activity) => {
          if (!live) return
          setMemory({ activity, at: Date.now() })
          setMemoryError(null)
        })
        .catch(() => {
          if (live) setMemoryError(CONTEXT_COPY.memoryLoadFailed)
        })
    }
    load()
    const off = window.memory.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [sessionId])

  const selected = dialog.state.selectedId
  const category = isCategory(selected) ? selected : FIRST_CONTEXT_CATEGORY
  const report = setup?.state === 'ready' ? setup.report : null
  const loadNotice =
    loadError === null ? null : (
      <Callout tone="danger" title={loadError} testId="context-load-error" />
    )

  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header />
        <ManageDialog.Columns>
          <ManageDialog.List>
            <ManageDialog.Rows>
              {CONTEXT_CATEGORIES.map((c) => {
                const tokens =
                  report === null ? null : categoryTokens(report, c.id, memory?.activity ?? null)
                return (
                  <ManageDialog.Row
                    key={c.id}
                    id={c.id}
                    testId={`context-row-${c.id}`}
                    selectTestId={`context-category-${c.id}`}
                  >
                    <span className={styles.railLabel}>
                      <span data-testid="context-category-label">{c.label}</span>
                      {tokens !== null ? (
                        <span className={styles.railTokens} data-testid="context-category-tokens">
                          {CONTEXT_COPY.tokens(tokens)}
                        </span>
                      ) : (
                        report !== null && (
                          // Same kind, same size: a row with no tokens keeps the second line.
                          <span className={styles.railTokens} aria-hidden>
                            {'\u00a0'}
                          </span>
                        )
                      )}
                    </span>
                  </ManageDialog.Row>
                )
              })}
            </ManageDialog.Rows>
          </ManageDialog.List>
          {report !== null && sessionId !== null ? (
            <ManageDialog.Pane testId={`context-pane-${category}`}>
              {loadNotice}
              <ContextPage
                key={category}
                category={category}
                report={report}
                sessionId={sessionId}
                memory={memory}
                memoryError={memoryError}
              />
            </ManageDialog.Pane>
          ) : loadNotice !== null && !ended ? (
            // Nothing to show and the read failed: the notice stands in for the waiting sentence,
            // which would claim a report is on its way.
            <ManageDialog.Pane>{loadNotice}</ManageDialog.Pane>
          ) : (
            <ManageDialog.Placeholder testId="context-placeholder">
              {ended
                ? CONTEXT_COPY.ended
                : setup?.state === 'unavailable'
                  ? UNAVAILABLE_COPY[setup.reason]
                  : CONTEXT_COPY.waiting}
            </ManageDialog.Placeholder>
          )}
        </ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
