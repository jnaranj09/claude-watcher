// Context's right-column pages (spec 2026-10-18 §5). Each page is a list of read-only rows in the
// Settings pane's row look (label left, details and actions right). Skills and agents have no
// path in the engine's data, so they have no open action. Instructions opens a file's History in
// place of the list, held by the file's PATH (a new report may list the files in another order);
// any absolute path has `Open in editor`; only an absolute `.md` path (`isInstructionPath`) has
// History.
import { Children, useState, type JSX, type ReactNode } from 'react'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { ModReport } from '../../../../shared/ipc/contract'
import type { MemoryActivity } from '../../../../shared/schemas/memory'
import { Callout } from '../Callout/Callout'
import { relativeEnded } from '../PastSessionsDialog/pastSessionsView'
import { isAbsolutePath, isInstructionPath } from '../../../../shared/schemas/contextIpc'
import {
  CONTEXT_COPY,
  DROP_REASON_COPY,
  contextErrorCopy,
  fileName,
  tierLabel,
  type ContextCategoryId
} from './contextCopy'
import { ContextHistory } from './ContextHistory'
import styles from './ContextDialog.module.css'

function Row({
  testId,
  title,
  name,
  details,
  children
}: {
  testId: string
  title?: string
  name: string
  /** Shown in order, each its own item; a null part is left out. */
  details: readonly (string | null)[]
  children?: ReactNode
}): JSX.Element {
  return (
    <div className={styles.row} data-testid={testId}>
      <span className={styles.text}>
        <span className={styles.name} data-testid={`${testId}-name`} title={title ?? name}>
          {name}
        </span>
        <span className={styles.details}>
          {details
            .filter((d) => d !== null)
            .map((d) => (
              <span key={d}>{d}</span>
            ))}
        </span>
      </span>
      {Children.toArray(children).length > 0 && <span className={styles.actions}>{children}</span>}
    </div>
  )
}

function Rows({ empty, children }: { empty: string; children: ReactNode[] }): JSX.Element {
  if (children.length === 0) return <p className={styles.empty}>{CONTEXT_COPY.empty(empty)}</p>
  return <div data-settings-group="">{children}</div>
}

function InstructionsPage({
  report,
  sessionId
}: {
  report: ModReport
  sessionId: string
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const tokensByPath = new Map(report.memoryFiles.map((m) => [m.path, m.tokens]))

  // Main resolves a file by its index in the report it holds now, the one this list shows.
  const historyIndex = report.instructionFiles.findIndex((f) => f.path === historyOf)
  if (historyOf !== null && historyIndex !== -1) {
    return (
      <ContextHistory
        sessionId={sessionId}
        fileIndex={historyIndex}
        name={fileName(historyOf)}
        onBack={() => setHistoryOf(null)}
      />
    )
  }

  return (
    <Rows empty="instruction files">
      {report.instructionFiles.map((f, i) => {
        const tokens = tokensByPath.get(f.path)
        return (
          <Row
            key={`${i}-${f.path}`}
            testId="context-file"
            name={fileName(f.path)}
            title={f.path}
            details={[
              tierLabel(f.kind),
              f.parent === undefined ? null : CONTEXT_COPY.importedBy(fileName(f.parent)),
              tokens === undefined ? null : CONTEXT_COPY.tokens(tokens)
            ]}
          >
            {isAbsolutePath(f.path) ? (
              <ManageDialog.GhostButton
                testId="context-file-open"
                size="sm"
                onClick={() => {
                  actions.setError(null)
                  window.context
                    .open(sessionId, i)
                    .catch((err: unknown) =>
                      actions.setError(contextErrorCopy('open', err, fileName(f.path)))
                    )
                }}
              >
                {CONTEXT_COPY.openInEditor}
              </ManageDialog.GhostButton>
            ) : undefined}
            {isInstructionPath(f.path) ? (
              <ManageDialog.GhostButton
                testId="context-file-history"
                size="sm"
                onClick={() => {
                  actions.setError(null)
                  setHistoryOf(f.path)
                }}
              >
                {CONTEXT_COPY.history}
              </ManageDialog.GhostButton>
            ) : undefined}
          </Row>
        )
      })}
    </Rows>
  )
}

export type MemoryLoad = { activity: MemoryActivity; at: number }

type ActivityEntry = MemoryActivity['entries'][number]

/** Which list an entry is under: what the session pulled; what it saved (an update, a task report
 *  and a stale mark are writes too, so they list with the saves); what extraction dropped. */
const LIST_OF: Readonly<Record<ActivityEntry['action'], 'pulled' | 'saved' | 'dropped'>> = {
  pulled: 'pulled',
  saved: 'saved',
  updated: 'saved',
  marked_stale: 'saved',
  dropped: 'dropped'
}

/** What this session was given at launch, then what it pulled, what it saved and what extraction
 *  dropped (memory phase 2), each entry under exactly one of them. `at` is when the answer came,
 *  the "now" its times are measured from. A row names the tool, or for a drop the reason in plain
 *  words; it never needs an item id (a task report has none). */
export function MemoryPage({
  memory,
  error
}: {
  memory: MemoryLoad | null
  error: string | null
}): JSX.Element {
  const notice =
    error === null ? null : (
      <Callout tone="danger" title={error} testId="context-memory-load-error" />
    )
  if (memory === null) return <>{notice}</>
  const { activity, at } = memory
  const entries = (
    list: 'pulled' | 'saved' | 'dropped',
    title: string,
    none: string
  ): JSX.Element => {
    const rows = activity.entries.filter((e) => LIST_OF[e.action] === list)
    const testId = list === 'dropped' ? 'context-memory-dropped-entry' : 'context-memory-entry'
    return (
      <section data-testid={`context-memory-${list}`}>
        <h4 className={styles.section}>{title}</h4>
        {rows.length === 0 ? (
          <p className={styles.empty}>{none}</p>
        ) : (
          <div data-settings-group="">
            {rows.map((e, i) => (
              <Row
                key={`${i}-${e.at}-${e.tool}`}
                testId={testId}
                name={list === 'dropped' && e.reason !== null ? DROP_REASON_COPY[e.reason] : e.tool}
                details={[relativeEnded(e.at, at)]}
              />
            ))}
          </div>
        )}
      </section>
    )
  }
  return (
    <div className={styles.sections}>
      {notice}
      <section>
        <h4 className={styles.section}>{CONTEXT_COPY.injected}</h4>
        <p className={styles.empty} data-testid="context-memory-injected">
          {activity.injected === null
            ? CONTEXT_COPY.nothingInjected
            : CONTEXT_COPY.injectedSummary(
                activity.injected.tokens,
                activity.injected.itemIds.length
              )}
        </p>
      </section>
      {entries('pulled', CONTEXT_COPY.pulled, CONTEXT_COPY.nothingPulled)}
      {entries('saved', CONTEXT_COPY.saved, CONTEXT_COPY.nothingSaved)}
      {entries('dropped', CONTEXT_COPY.dropped, CONTEXT_COPY.nothingDropped)}
    </div>
  )
}

export function ContextPage({
  category,
  report,
  sessionId
}: {
  category: Exclude<ContextCategoryId, 'memory'>
  report: ModReport
  sessionId: string
}): JSX.Element {
  switch (category) {
    case 'instructions':
      return <InstructionsPage report={report} sessionId={sessionId} />
    case 'skills':
      return (
        <Rows empty="skills">
          {(report.skills ?? []).map((s, i) => (
            <Row
              key={`${i}-${s.name}`}
              testId="context-skill"
              name={s.name}
              details={[
                s.pluginName === undefined ? s.source : `${s.source} · ${s.pluginName}`,
                CONTEXT_COPY.tokens(s.tokens)
              ]}
            />
          ))}
        </Rows>
      )
    case 'agents':
      return (
        <Rows empty="agents">
          {report.agents.map((a, i) => (
            <Row
              key={`${i}-${a.agentType}`}
              testId="context-agent"
              name={a.agentType}
              details={[a.source, CONTEXT_COPY.tokens(a.tokens)]}
            />
          ))}
        </Rows>
      )
    case 'mcp':
      return (
        <Rows empty="MCP servers">
          {report.mcpServers.map((m, i) => (
            <Row
              key={`${i}-${m.name}`}
              testId="context-mcp"
              name={m.name}
              details={[
                `${m.toolCount} tools · ${m.loadedCount} loaded`,
                CONTEXT_COPY.tokens(m.tokens)
              ]}
            />
          ))}
        </Rows>
      )
    case 'commands':
      return (
        <Rows empty="commands">
          {report.slashCommands === null
            ? []
            : [
                <Row
                  key="commands"
                  testId="context-commands"
                  name={`${report.slashCommands.total} commands`}
                  details={[CONTEXT_COPY.tokens(report.slashCommands.tokens)]}
                />
              ]}
        </Rows>
      )
    case 'hooks':
      return (
        <Rows empty="hooks">
          {report.hookEvents.map((h, i) => (
            <Row
              key={`${i}-${h.event}-${h.source}`}
              testId="context-hook"
              name={h.event}
              details={[h.source, h.count === 1 ? '1 hook' : `${h.count} hooks`]}
            />
          ))}
        </Rows>
      )
    case 'plugins':
      return (
        <Rows empty="plugins">
          {report.plugins.map((p, i) => (
            <Row
              key={`${i}-${p.name}`}
              testId="context-plugin"
              name={p.name}
              details={[p.source]}
            />
          ))}
        </Rows>
      )
  }
}
