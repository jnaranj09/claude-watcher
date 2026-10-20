// A bridge mod report as main receives it at `/mod/report` (spec 2026-10-18 §2). Shared by the
// boundary, the hook server, the session setup and the Context tests.
import type { ModReport } from '../shared/schemas/modReport'

export const MOD_REPORT_SESSION_ID = 'aaaaaaaa-0000-4000-8000-0000000000aa'

export function modReportFixture(overrides: Partial<ModReport> = {}): ModReport {
  return {
    version: 1,
    sessionId: MOD_REPORT_SESSION_ID,
    instructionFiles: [
      { path: '/home/op/.claude/CLAUDE.md', kind: 'user' },
      { path: '/work/app/CLAUDE.md', kind: 'project' },
      { path: '/work/app/docs/rules.md', kind: 'project', parent: '/work/app/CLAUDE.md' }
    ],
    memoryFiles: [{ path: '/work/app/CLAUDE.md', type: 'Project', tokens: 1200 }],
    skills: [
      { name: 'tdd', source: 'plugin', pluginName: 'superpowers', tokens: 50 },
      { name: 'deploy', source: 'userSettings', tokens: 40 }
    ],
    agents: [{ agentType: 'Explore', source: 'built-in', tokens: 300 }],
    mcpServers: [{ name: 'jira', toolCount: 4, tokens: 900, loadedCount: 2 }],
    slashCommands: { total: 12, tokens: 300 },
    hookEvents: [{ event: 'Stop', source: 'user', count: 2 }],
    plugins: [{ name: 'superpowers@claude-plugins-official', source: 'user' }],
    ...overrides
  }
}
