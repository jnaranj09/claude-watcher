// The command and env of one claude spawn (the launch path's seam, `rawClaudeSpawn` in
// ipc/registerLaunchIpc.ts): the bridge mod's folder reaches `--plugin-dir`, goals and memory are
// joined, and the login shell runs the composed command.
import { describe, expect, it } from 'vitest'
import type { GoalSpawnExtras } from '../goals/goalLaunch'
import { NO_MEMORY_EXTRAS } from '../memory/memoryLaunch'
import { QUESTION_FORMAT_PROMPT, shellQuote } from './claudeBin'
import {
  claudeSpawnCommand,
  type ClaudeSpawnDeps,
  type ClaudeSpawnRequest
} from './claudeSpawnCommand'

const SID = 'aaaaaaaa-0000-4000-8000-000000000001'
const NO_GOAL: GoalSpawnExtras = {
  appendPrompt: null,
  mcpConfigPath: null,
  allowedTools: null,
  taskIds: []
}

function deps(over: Partial<ClaudeSpawnDeps> = {}): ClaudeSpawnDeps & { skips: string[] } {
  const skips: string[] = []
  return {
    shell: '/bin/bash',
    hookListening: () => true,
    bridgeMod: {
      installedDir: () => '/data/mods/watcher-bridge',
      claudeVersion: () => ({ major: 2, minor: 1, patch: 323 }),
      hookPort: 19279,
      onSkip: (_id, reason) => skips.push(reason)
    },
    goalSpawnExtras: () => NO_GOAL,
    memorySpawnExtras: () => ({ ...NO_MEMORY_EXTRAS, env: {} }),
    activeWorkspaceId: () => 'w1',
    claudeAutoMemory: () => 'claude',
    hookSettingsPath: () => '/data/hooks.json',
    log: () => undefined,
    skips,
    ...over
  }
}

function request(over: Partial<ClaudeSpawnRequest> = {}): ClaudeSpawnRequest {
  return {
    sessionId: SID,
    displayName: 'x',
    flags: { model: null, permissionMode: null, effort: null },
    initialPrompt: null,
    resume: false,
    goalLaunch: null,
    previousSessionId: null,
    launch: { cwd: '/work/app', workspaceId: 'w1' },
    claudeCommand: '/opt/bin/claude',
    env: { PATH: '/usr/bin' },
    ...over
  }
}

describe('claudeSpawnCommand', () => {
  it('passes the installed bridge mod folder to --plugin-dir and its report URL to the env', () => {
    const d = deps()
    expect(claudeSpawnCommand(d, request())).toEqual({
      file: '/bin/bash',
      args: [
        '-l',
        '-c',
        `'/opt/bin/claude' --session-id '${SID}' -n 'x' --settings '/data/hooks.json' --plugin-dir '/data/mods/watcher-bridge' --append-system-prompt ${shellQuote(QUESTION_FORMAT_PROMPT)}`
      ],
      env: {
        PATH: '/usr/bin',
        CLAUDE_WATCHER_MOD_URL: 'http://127.0.0.1:19279/mod/report'
      }
    })
    expect(d.skips).toEqual([])
  })

  it('a session given the memory mod gets its folder after the bridge mod’s, and the config env var', () => {
    const d = deps({
      memorySpawnExtras: () => ({
        appendPrompt: null,
        mcpConfigPath: '/data/mcp/m.json',
        allowedTools: 'mcp__claude-watcher-memory__memory_search',
        pluginDir: '/data/mods/watcher-memory',
        env: { CLAUDE_WATCHER_MEMORY: '1', CLAUDE_WATCHER_MEMORY_CONFIG: '/data/mcp/m.json' }
      })
    })
    expect(claudeSpawnCommand(d, request())).toEqual({
      file: '/bin/bash',
      args: [
        '-l',
        '-c',
        `'/opt/bin/claude' --session-id '${SID}' -n 'x' --settings '/data/hooks.json' --plugin-dir '/data/mods/watcher-bridge' --plugin-dir '/data/mods/watcher-memory' --append-system-prompt ${shellQuote(QUESTION_FORMAT_PROMPT)} --mcp-config '/data/mcp/m.json' --allowedTools 'mcp__claude-watcher-memory__memory_search'`
      ],
      env: {
        PATH: '/usr/bin',
        CLAUDE_WATCHER_MOD_URL: 'http://127.0.0.1:19279/mod/report',
        CLAUDE_WATCHER_MEMORY: '1',
        CLAUDE_WATCHER_MEMORY_CONFIG: '/data/mcp/m.json'
      }
    })
  })

  it('a skipped bridge mod puts no --plugin-dir on the command and tells Context why', () => {
    const d = deps({
      bridgeMod: {
        ...deps().bridgeMod,
        installedDir: () => null,
        onSkip: (_id, r) => d.skips.push(r)
      }
    })
    const out = claudeSpawnCommand(d, request())
    expect([out.args[2]?.includes('--plugin-dir'), out.env, d.skips]).toEqual([
      false,
      { PATH: '/usr/bin' },
      ['mod_not_installed']
    ])
  })

  it.each([true, false])(
    'memory is told whether the spawn resumes a conversation (resume %s)',
    (resume) => {
      const asked: unknown[] = []
      const d = deps({
        memorySpawnExtras: (_id, launch) => {
          asked.push(launch)
          return { ...NO_MEMORY_EXTRAS, env: {} }
        }
      })
      claudeSpawnCommand(d, request({ resume }))
      expect(asked).toEqual([{ cwd: '/work/app', workspaceId: 'w1', excludeTaskIds: [], resume }])
    }
  )
})
