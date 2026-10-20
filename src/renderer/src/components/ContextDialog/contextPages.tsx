// Context's right-column pages (spec 2026-10-18 §5). Each page is a list of read-only rows in the
// Settings pane's row look (label left, details and actions right). Skills and agents have no
// path in the engine's data, so they have no open action. Instructions opens a file's History in
// place of the list.
import { useState, type JSX, type ReactNode } from 'react'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import type { ModReport } from '../../../../shared/ipc/contract'
import {
  CONTEXT_COPY,
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
      {children !== undefined && <span className={styles.actions}>{children}</span>}
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
  const [historyOf, setHistoryOf] = useState<number | null>(null)
  const tokensByPath = new Map(report.memoryFiles.map((m) => [m.path, m.tokens]))

  const file = historyOf === null ? undefined : report.instructionFiles[historyOf]
  if (historyOf !== null && file !== undefined) {
    return (
      <ContextHistory
        sessionId={sessionId}
        fileIndex={historyOf}
        name={fileName(file.path)}
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
            <ManageDialog.GhostButton
              testId="context-file-history"
              size="sm"
              onClick={() => {
                actions.setError(null)
                setHistoryOf(i)
              }}
            >
              {CONTEXT_COPY.history}
            </ManageDialog.GhostButton>
          </Row>
        )
      })}
    </Rows>
  )
}

export function ContextPage({
  category,
  report,
  sessionId
}: {
  category: ContextCategoryId
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
