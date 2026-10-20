// The bridge mod's report: engine data in, a paths-and-counts report out (spec 2026-10-18 §1.3).
// PURE: no engine call, no import outside this folder (layer guard), so it is unit-tested under
// node. It never carries file content or a settings value — only paths, names, sources and counts.
// Main parses the same shape with `ModReportSchema` (src/shared/schemas/modReport.ts); a test
// there parses this builder's output so the two cannot drift.

/** The settings sources read for hook and plugin names. `flag` is left out: in an app-launched
 *  session it is the app's own `--settings` hook block, plumbing the operator did not write. */
export const REPORT_SOURCES = ['user', 'project', 'local', 'policy'] as const
type ReportSource = (typeof REPORT_SOURCES)[number]

/** The bridge mod's own name, left out of the plugins list. */
const BRIDGE_MOD_NAME = 'watcher-bridge'

export interface EngineData {
  /** `prompt.context`'s files; `content` may be present and is dropped. */
  instructionFiles: readonly { path: string; kind: string; parent?: string; content?: string }[]
  /** `usage({ breakdown: 'summary' }).context.breakdown`, when the engine gave one. */
  breakdown:
    | {
        memoryFiles: readonly { path: string; type: string; tokens: number }[]
        mcpTools: readonly { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
        agents: readonly { agentType: string; source: string; tokens: number }[]
        slashCommands?: { totalCommands: number; includedCommands: number; tokens: number }
        skills?: {
          totalSkills: number
          includedSkills: number
          tokens: number
          skillFrontmatter: readonly {
            name: string
            source: string
            pluginName?: string
            tokens: number
          }[]
        }
      }
    | undefined
  /** `settings.read({ source })` per source (any source may be missing). */
  settings: Partial<Record<ReportSource | 'flag', Readonly<Record<string, unknown>>>>
}

export interface ModReport {
  version: 1
  sessionId: string
  instructionFiles: { path: string; kind: string; parent?: string }[]
  memoryFiles: { path: string; type: string; tokens: number }[]
  skills: { name: string; source: string; pluginName?: string; tokens: number }[] | null
  agents: { agentType: string; source: string; tokens: number }[]
  mcpServers: { name: string; toolCount: number; tokens: number; loadedCount: number }[]
  slashCommands: { total: number; tokens: number } | null
  hookEvents: { event: string; source: string; count: number }[]
  plugins: { name: string; source: string }[]
}

export function buildReport(input: EngineData, sessionId: string): ModReport {
  const b = input.breakdown
  return {
    version: 1,
    sessionId,
    instructionFiles: input.instructionFiles.map((f) => ({
      path: f.path,
      kind: f.kind,
      ...(f.parent !== undefined ? { parent: f.parent } : {})
    })),
    memoryFiles: (b?.memoryFiles ?? []).map((m) => ({
      path: m.path,
      type: m.type,
      tokens: m.tokens
    })),
    skills:
      b?.skills === undefined
        ? null
        : b.skills.skillFrontmatter.map((s) => ({
            name: s.name,
            source: s.source,
            ...(s.pluginName !== undefined ? { pluginName: s.pluginName } : {}),
            tokens: s.tokens
          })),
    agents: (b?.agents ?? []).map((a) => ({
      agentType: a.agentType,
      source: a.source,
      tokens: a.tokens
    })),
    mcpServers: groupMcpTools(b?.mcpTools ?? []),
    slashCommands:
      b?.slashCommands === undefined
        ? null
        : { total: b.slashCommands.totalCommands, tokens: b.slashCommands.tokens },
    hookEvents: REPORT_SOURCES.flatMap((source) => hookEvents(input.settings[source], source)),
    plugins: REPORT_SOURCES.flatMap((source) => plugins(input.settings[source], source))
  }
}

/** A stable string for "did the report change": the mod sends only when this differs from the
 *  last report it sent. It holds the session id, so a `/clear` (new id) always sends again. */
export function reportKey(report: ModReport): string {
  return JSON.stringify(report)
}

function groupMcpTools(
  tools: readonly { serverName: string; tokens: number; isLoaded: boolean }[]
): ModReport['mcpServers'] {
  const byServer = new Map<string, ModReport['mcpServers'][number]>()
  for (const t of tools) {
    const s = byServer.get(t.serverName) ?? {
      name: t.serverName,
      toolCount: 0,
      tokens: 0,
      loadedCount: 0
    }
    s.toolCount += 1
    s.tokens += t.tokens
    if (t.isLoaded) s.loadedCount += 1
    byServer.set(t.serverName, s)
  }
  return [...byServer.values()]
}

/** `hooks` is `{ <Event>: [{ matcher?, hooks: [...] }] }`; the count is the hook entries. Only the
 *  event NAME leaves; a value that is not that shape counts nothing. */
function hookEvents(
  settings: Readonly<Record<string, unknown>> | undefined,
  source: ReportSource
): ModReport['hookEvents'] {
  const hooks = settings?.hooks
  if (!isRecord(hooks)) return []
  const out: ModReport['hookEvents'] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    let count = 0
    for (const g of groups) if (isRecord(g) && Array.isArray(g.hooks)) count += g.hooks.length
    if (count > 0) out.push({ event, source, count })
  }
  return out
}

/** `enabledPlugins` is `{ "<name>@<marketplace>": boolean }`; only enabled names leave. */
function plugins(
  settings: Readonly<Record<string, unknown>> | undefined,
  source: ReportSource
): ModReport['plugins'] {
  const enabled = settings?.enabledPlugins
  if (!isRecord(enabled)) return []
  return Object.entries(enabled)
    .filter(([name, on]) => on === true && name.split('@')[0] !== BRIDGE_MOD_NAME)
    .map(([name]) => ({ name, source }))
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
