// The command and env of one claude spawn (the launch path's seam, `rawClaudeSpawn` in
// ipc/registerLaunchIpc.ts): the bridge mod's folder reaches `--plugin-dir`, goals and memory are
// joined, and the login shell runs the composed command.
import { describe, expect, it } from 'vitest'
import type { GoalSpawnExtras } from '../goals/goalLaunch'
import { NO_MEMORY_EXTRAS } from '../memory/memoryLaunch'
import { createHookChannel, type HookChannel } from '../hooks/hookChannel'
import { QUESTION_FORMAT_PROMPT, shellQuote } from './claudeBin'
import {
  claudeSpawnCommand,
  type ClaudeSpawnDeps,
  type ClaudeSpawnRequest
} from './claudeSpawnCommand'

const SID = 'aaaaaaaa-0000-4000-8000-000000000001'
/** The channel token every spawn here mints (a fixed random source). */
const TOKEN = 'c'.repeat(64)
const NO_GOAL: GoalSpawnExtras = {
  appendPrompt: null,
  mcpConfigPath: null,
  allowedTools: null,
  taskIds: []
}

function deps(
  over: Partial<ClaudeSpawnDeps> = {},
  channel: HookChannel = createHookChannel(() => TOKEN)
): ClaudeSpawnDeps & {
  skips: string[]
  channel: HookChannel
  removedFiles: string[]
  settingsAsked: (string | null)[]
} {
  const skips: string[] = []
  const removedFiles: string[] = []
  const settingsAsked: (string | null)[] = []
  return {
    shell: '/bin/bash',
    hookListening: () => true,
    hookChannel: channel,
    channel,
    hookSettingsFiles: { remove: (id) => void removedFiles.push(id) },
    removedFiles,
    settingsAsked,
    bridgeMod: {
      installedDir: () => '/data/mods/watcher-bridge',
      claudeVersion: () => ({ major: 2, minor: 1, patch: 323 }),
      hookPort: 19279,
      onSkip: (_id, reason) => skips.push(reason)
    },
    notePlanner: () => undefined,
    carrySessionGoal: () => undefined,
    goalSpawnExtras: () => NO_GOAL,
    memorySpawnExtras: () => ({ ...NO_MEMORY_EXTRAS, env: {} }),
    memoryResumed: () => undefined,
    activeWorkspaceId: () => 'w1',
    claudeAutoMemory: () => 'claude',
    hookSettingsPath: (_id, token) => {
      settingsAsked.push(token)
      return token === null ? null : '/data/hooks.json'
    },
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
        CLAUDE_WATCHER_MOD_URL: `http://127.0.0.1:19279/h/${TOKEN}/mod/report`
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
        CLAUDE_WATCHER_MOD_URL: `http://127.0.0.1:19279/h/${TOKEN}/mod/report`,
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

  it('a resume spawn calls memoryResumed with the resolved workspace', () => {
    const seen: string[][] = []
    const d = deps({
      activeWorkspaceId: () => 'w-active',
      memoryResumed: (id, ws) => seen.push([id, ws])
    })
    claudeSpawnCommand(
      d,
      request({ resume: true, launch: { cwd: '/work/app', workspaceId: null } })
    )
    expect(seen).toEqual([[SID, 'w-active']])
  })

  it('a fresh spawn does not call memoryResumed', () => {
    const seen: string[][] = []
    const d = deps({ memoryResumed: (id, ws) => seen.push([id, ws]) })
    claudeSpawnCommand(d, request({ resume: false }))
    expect(seen).toEqual([])
  })

  describe('the memory goal carry and the planner record', () => {
    const PREV = 'aaaaaaaa-0000-4000-8000-000000000000'
    const GOALS = {
      worker: { kind: 'worker', taskIds: ['t1'], markDone: false } as const,
      planner: { kind: 'planner', goalId: 'g1' } as const
    }
    function run(over: Partial<ClaudeSpawnRequest>): string[] {
      const calls: string[] = []
      const d = deps({
        carrySessionGoal: (p, n) => calls.push(`carry ${p} ${n}`),
        notePlanner: (s, g) => calls.push(`planner ${s} ${g}`),
        goalSpawnExtras: () => {
          calls.push('goalSpawnExtras')
          return NO_GOAL
        }
      })
      claudeSpawnCommand(d, request(over))
      return calls
    }

    it.each([
      ['a plain session', null],
      ['a worker', GOALS.worker]
    ])('a Reopen of %s carries, and records no planner', (_n, goalLaunch) => {
      expect(run({ previousSessionId: PREV, goalLaunch })).toEqual([
        `carry ${PREV} ${SID}`,
        'goalSpawnExtras'
      ])
    })

    it('a Reopen of a planner carries, then records the planner, both before goalSpawnExtras', () => {
      expect(run({ previousSessionId: PREV, goalLaunch: GOALS.planner })).toEqual([
        `carry ${PREV} ${SID}`,
        `planner ${SID} g1`,
        'goalSpawnExtras'
      ])
    })

    it('a planner first spawn records the planner and carries nothing', () => {
      expect(run({ goalLaunch: GOALS.planner })).toEqual([`planner ${SID} g1`, 'goalSpawnExtras'])
    })

    it('a resume carries nothing, and a first spawn carries nothing', () => {
      expect(run({ previousSessionId: PREV, resume: true })).toEqual(['goalSpawnExtras'])
      expect(run({})).toEqual(['goalSpawnExtras'])
    })
  })

  describe('the hook channel token (T-D13)', () => {
    it('is minted once and goes to the settings file and the mod env, never to the command line', () => {
      const d = deps()
      const out = claudeSpawnCommand(d, request())
      expect([
        d.settingsAsked,
        out.env.CLAUDE_WATCHER_MOD_URL?.includes(`/h/${TOKEN}/`),
        out.args.some((a) => a.includes(TOKEN)),
        d.channel.resolve(TOKEN)
      ]).toEqual([[TOKEN], true, false, { sessionId: SID }])
    })

    it('is not minted when the hook port is not ours: no settings file, no mod URL', () => {
      const d = deps({ hookListening: () => false })
      const out = claudeSpawnCommand(d, request())
      expect([d.settingsAsked, out.env, d.channel.resolve(TOKEN)]).toEqual([
        [null],
        { PATH: '/usr/bin' },
        null
      ])
    })

    it('is revoked when neither the settings file nor the mod took it', () => {
      const d = deps({ hookSettingsPath: () => null })
      claudeSpawnCommand(
        { ...d, bridgeMod: { ...d.bridgeMod, installedDir: () => null } },
        request()
      )
      expect(d.channel.resolve(TOKEN)).toBeNull()
    })

    it("a Reopen revokes the replaced id's token and deletes its file before this spawn mints", () => {
      const PREV = 'aaaaaaaa-0000-4000-8000-000000000000'
      let n = 0
      const channel = createHookChannel(() => String(n++).repeat(64))
      const oldToken = channel.mint({ sessionId: PREV })
      const d = deps({}, channel)
      claudeSpawnCommand(d, request({ previousSessionId: PREV }))
      expect([channel.resolve(oldToken), d.removedFiles, channel.resolve('1'.repeat(64))]).toEqual([
        null,
        [PREV],
        { sessionId: SID }
      ])
    })
  })
})
