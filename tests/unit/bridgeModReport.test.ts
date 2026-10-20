// The bridge mod's report builder (src/mod/watcher-bridge/hooks/report.ts): engine data in, the paths-and-counts report out (spec
// 2026-10-18 §1.3). The shapes below are the ones the probe saw on claude 2.1.304.
import { describe, it, expect } from 'vitest'
import { buildReport, reportKey, type EngineData } from '../../src/mod/watcher-bridge/hooks/report'

const SID = '11111111-2222-4333-8444-555555555555'

function data(overrides: Partial<EngineData> = {}): EngineData {
  return {
    instructionFiles: [
      { path: '/home/op/.claude/CLAUDE.md', kind: 'user', content: 'SECRET TEXT' },
      { path: '/p/CLAUDE.md', kind: 'project', content: 'x' },
      { path: '/p/extra.md', kind: 'project', content: 'y', parent: '/p/CLAUDE.md' }
    ],
    breakdown: {
      memoryFiles: [{ path: '/p/CLAUDE.md', type: 'Project', tokens: 120 }],
      mcpTools: [
        { name: 'a', serverName: 'jira', tokens: 10, isLoaded: true },
        { name: 'b', serverName: 'jira', tokens: 5, isLoaded: false },
        { name: 'c', serverName: 'git', tokens: 7, isLoaded: true }
      ],
      agents: [{ agentType: 'Explore', source: 'built-in', tokens: 40 }],
      slashCommands: { totalCommands: 12, includedCommands: 10, tokens: 300 },
      skills: {
        totalSkills: 2,
        includedSkills: 2,
        tokens: 90,
        skillFrontmatter: [
          { name: 'tdd', source: 'plugin', pluginName: 'superpowers', tokens: 50 },
          { name: 'mine', source: 'userSettings', tokens: 40 }
        ]
      }
    },
    settings: {
      user: {
        env: { SECRET: 'x' },
        permissions: { allow: ['Bash(rm -rf /secret-perm)'] },
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo secret-cmd' }, { type: 'command' }] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }]
        },
        enabledPlugins: {
          'superpowers@claude-plugins-official': true,
          'off@m': false,
          'watcher-bridge@local': true
        }
      },
      project: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'y' }] }] } },
      flag: { hooks: { Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9279/' }] }] } }
    },
    ...overrides
  }
}

describe('buildReport', () => {
  it('keeps path, kind and parent of each instruction file and never its content', () => {
    const r = buildReport(data(), SID)
    expect(r.instructionFiles).toEqual([
      { path: '/home/op/.claude/CLAUDE.md', kind: 'user' },
      { path: '/p/CLAUDE.md', kind: 'project' },
      { path: '/p/extra.md', kind: 'project', parent: '/p/CLAUDE.md' }
    ])
    expect(JSON.stringify(r)).not.toContain('SECRET TEXT')
  })

  it('stamps version 1 and the session id', () => {
    const r = buildReport(data(), SID)
    expect(r.version).toBe(1)
    expect(r.sessionId).toBe(SID)
  })

  it('groups MCP tools by server into tool count, tokens and loaded count', () => {
    expect(buildReport(data(), SID).mcpServers).toEqual([
      { name: 'jira', toolCount: 2, tokens: 15, loadedCount: 1 },
      { name: 'git', toolCount: 1, tokens: 7, loadedCount: 1 }
    ])
  })

  it('maps skills with their plugin name only when set', () => {
    expect(buildReport(data(), SID).skills).toEqual([
      { name: 'tdd', source: 'plugin', pluginName: 'superpowers', tokens: 50 },
      { name: 'mine', source: 'userSettings', tokens: 40 }
    ])
  })

  it('gives null skills and null commands when the engine lists none', () => {
    const r = buildReport(data({ breakdown: { memoryFiles: [], mcpTools: [], agents: [] } }), SID)
    expect(r.skills).toBeNull()
    expect(r.slashCommands).toBeNull()
  })

  it('gives empty lists when the engine gave no breakdown at all', () => {
    const r = buildReport(data({ breakdown: undefined }), SID)
    expect(r.memoryFiles).toEqual([])
    expect(r.agents).toEqual([])
    expect(r.mcpServers).toEqual([])
  })

  it('maps memory files, agents and slash commands', () => {
    const r = buildReport(data(), SID)
    expect(r.memoryFiles).toEqual([{ path: '/p/CLAUDE.md', type: 'Project', tokens: 120 }])
    expect(r.agents).toEqual([{ agentType: 'Explore', source: 'built-in', tokens: 40 }])
    expect(r.slashCommands).toEqual({ total: 12, tokens: 300 })
  })

  it('counts hook entries per event and source, leaving out the app’s own --settings (flag)', () => {
    expect(buildReport(data(), SID).hookEvents).toEqual([
      { event: 'Stop', source: 'user', count: 2 },
      { event: 'PreToolUse', source: 'user', count: 1 },
      { event: 'Stop', source: 'project', count: 1 }
    ])
  })

  it('lists enabled plugins by name and source, leaving out disabled ones and the bridge mod', () => {
    expect(buildReport(data(), SID).plugins).toEqual([
      { name: 'superpowers@claude-plugins-official', source: 'user' }
    ])
  })

  it('carries no settings value: no env, no permission, no hook command or url', () => {
    const json = JSON.stringify(buildReport(data(), SID))
    for (const secret of ['SECRET', 'secret-perm', 'secret-cmd', 'echo', '127.0.0.1', 'allow']) {
      expect(json).not.toContain(secret)
    }
  })

  it('skips a hooks value that is not the settings shape instead of throwing', () => {
    const r = buildReport(
      data({ settings: { user: { hooks: { Stop: 'nope', Other: [{ hooks: 3 }, null] } } } }),
      SID
    )
    expect(r.hookEvents).toEqual([])
  })
})

describe('reportKey', () => {
  it('is the same for the same report', () => {
    expect(reportKey(buildReport(data(), SID))).toBe(reportKey(buildReport(data(), SID)))
  })

  it('changes when one token count changes', () => {
    const withTokens = (tokens: number): EngineData =>
      data({
        breakdown: {
          memoryFiles: [{ path: '/p/CLAUDE.md', type: 'Project', tokens }],
          mcpTools: [],
          agents: []
        }
      })
    expect(reportKey(buildReport(withTokens(121), SID))).not.toBe(
      reportKey(buildReport(withTokens(120), SID))
    )
  })

  it('changes when the session id changes (a /clear sends again under the new id)', () => {
    expect(reportKey(buildReport(data(), 'other-id'))).not.toBe(reportKey(buildReport(data(), SID)))
  })
})
