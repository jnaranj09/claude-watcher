// The command and env of ONE claude spawn, after the registrar resolved claude and built the base
// env (`rawClaudeSpawn`, ipc/registerLaunchIpc.ts). It lives here, not inline in the registrar,
// because the registrar is only reachable through Electron's ipc: a test can reach this, so the
// mod folders, the goals and memory parts and the order they are asked in each have a test.
// Order: the hook channel token (a Reopen's old one revoked first), then the bridge mod (its env
// var goes into `env`), then the Reopen carry of the memory goal and the planner record (both
// before goals), then goals (links the tasks to the minted id), then memory (inside
// `spawnExtras`), then the hook settings file.
import type { ClaudeVersion } from '../../shared/launch/claudeVersion'
import type { ModSkipReason } from '../../shared/schemas/contextIpc'
import type { ClaudeAutoMemory } from '../../shared/schemas/settings'
import type { GoalLaunch, GoalSpawnExtras } from '../goals/goalLaunch'
import type { HookChannel } from '../hooks/hookChannel'
import type { HookSettingsFiles } from '../hooks/hookSettingsFile'
import type { MemorySpawnExtras } from '../memory/memoryLaunch'
import { applyBridgeMod } from '../mods/bridgeModSpawn'
import { composeClaudeCommand, loginShellRun } from './claudeBin'
import type { ClaudeLaunchFlags } from './launchSession'
import { spawnExtras } from './spawnExtras'

export interface ClaudeSpawnDeps {
  /** The login shell every spawn runs claude under (`$SHELL -l -c`). */
  shell: string
  /** SEC-6: THIS process holds the hook port. */
  hookListening: () => boolean
  /** The app's hook channel (`hooks/hookChannel.ts`): one token per spawn, minted only while the
   *  hook port is ours; a Reopen revokes the replaced id's token. */
  hookChannel: Pick<HookChannel, 'mint' | 'revoke'>
  /** The per-session hook settings files: a Reopen deletes the replaced id's. */
  hookSettingsFiles: Pick<HookSettingsFiles, 'remove'>
  /** The bridge mod (spec 2026-10-18 §1.1): read at spawn time. */
  bridgeMod: {
    installedDir: () => string | null
    claudeVersion: () => ClaudeVersion | null
    hookPort: number
    onSkip: (sessionId: string, reason: ModSkipReason) => void
  }
  /** A planner spawn records that `sessionId` plans `goalId` (`GoalsStore.notePlanner`). Pass only
   *  a minted id and an existing goal id. Never throws. */
  notePlanner: (sessionId: string, goalId: string) => void
  /** A Reopen: `newId` joins `previousId`'s memory-goal family (`GoalsStore.carrySessionGoal`).
   *  Pass only minted ids. Never throws. */
  carrySessionGoal: (previousId: string, newId: string) => void
  goalSpawnExtras: (
    sessionId: string,
    goalLaunch: GoalLaunch | null,
    resume: boolean,
    previousSessionId: string | null
  ) => GoalSpawnExtras
  memorySpawnExtras: (
    sessionId: string,
    launch: {
      cwd: string
      workspaceId: string
      excludeTaskIds: readonly string[]
      resume: boolean
    },
    previousSessionId: string | null
  ) => MemorySpawnExtras
  /** A resume spawn: memory records where the transcript ends now when the session has no save
   *  row (`Extractor.resumed`), so its history is never saved. Never throws. */
  memoryResumed: (sessionId: string, workspaceId: string) => void
  activeWorkspaceId: () => string
  claudeAutoMemory: () => ClaudeAutoMemory
  /** The `--settings` file for `sessionId`'s channel `token`, or null (no token, SEC-6, a refused
   *  write). */
  hookSettingsPath: (sessionId: string, token: string | null) => string | null
  log: (line: string) => void
}

export interface ClaudeSpawnRequest {
  sessionId: string
  displayName: string
  flags: ClaudeLaunchFlags
  initialPrompt: string | null
  resume: boolean
  goalLaunch: GoalLaunch | null
  previousSessionId: string | null
  launch: { cwd: string; workspaceId: string | null }
  /** The resolved claude (`resolveClaudeOnDisk`). */
  claudeCommand: string
  /** The base child env (`buildPtyEnv`, claude's folder first in PATH). The bridge mod's var is
   *  written into it. */
  env: Record<string, string>
}

export function claudeSpawnCommand(
  deps: ClaudeSpawnDeps,
  request: ClaudeSpawnRequest
): { file: string; args: string[]; env: Record<string, string> } {
  const { sessionId, previousSessionId, env } = request

  // The hook channel (T-D13): the one secret the hook URL and the mod's report URL carry. A Reopen
  // (and a resume of the terminal) is a new spawn: the replaced id's token and file go first, and
  // this spawn mints its own.
  if (previousSessionId !== null) {
    deps.hookChannel.revoke(previousSessionId)
    deps.hookSettingsFiles.remove(previousSessionId)
  }
  const hookToken = deps.hookListening() ? deps.hookChannel.mint({ sessionId }) : null

  // The bridge mod: its folder (handed to spawnExtras, which lists it for `--plugin-dir`) plus
  // the report URL in the env, or a reason Context shows.
  // FAIL OPEN: a skip launches the session exactly as before the mod existed.
  const bridgePluginDir = applyBridgeMod({
    sessionId,
    env,
    channelToken: hookToken,
    installedDir: deps.bridgeMod.installedDir,
    version: deps.bridgeMod.claudeVersion,
    hookPort: deps.bridgeMod.hookPort,
    onSkip: deps.bridgeMod.onSkip,
    log: deps.log
  })

  // A Reopen (a previous id, no resume), plain, worker or planner, carries the memory goal and the
  // planner record to the new id; a planner then records that it plans its goal. Both before
  // goals, so everything the spawn adds already sees the new id. A dev StrictMode double mount
  // re-spawns the same way and carries again; both ids join one family.
  if (previousSessionId !== null && !request.resume) {
    deps.carrySessionGoal(previousSessionId, sessionId)
  }
  if (request.goalLaunch?.kind === 'planner') {
    deps.notePlanner(sessionId, request.goalLaunch.goalId)
  }

  // Goals: a session started from tasks gets them as context (its tasks are linked to THIS
  // minted id first), and `mark_task_done` when the operator chose it. Nothing for any other
  // launch.
  const goal = deps.goalSpawnExtras(
    sessionId,
    request.goalLaunch,
    request.resume,
    previousSessionId
  )
  // Memory: the memory tools for this launch with either the folder's index (no recall) or the
  // `watcher-memory` mod folder and its config var (recall: the mod sends the index as a section,
  // so the command carries none), or nothing at all (memory off, hook port not ours, database
  // closed, a failure). Joined with goals, with the child env and the operator's choice for
  // claude's own auto memory, in pty/spawnExtras.ts.
  const extras = spawnExtras({
    goal,
    // A resume tells memory so (P3-C28): the conversation keeps the system prompt of its first
    // request, so the index the mod sends in its first window never reaches the model.
    // A resume of a session with no save row starts its save at the transcript's end, in the
    // spawn's resolved workspace.
    memory: (target) => {
      if (request.resume) deps.memoryResumed(sessionId, target.workspaceId)
      return deps.memorySpawnExtras(
        sessionId,
        { ...target, resume: request.resume },
        previousSessionId
      )
    },
    launch: request.launch,
    activeWorkspaceId: deps.activeWorkspaceId,
    autoMemory: deps.claudeAutoMemory(),
    env,
    bridgePluginDir
  })

  // The token goes in the settings file and the mod's env, never on argv. Used by neither, it is
  // revoked.
  const hookSettingsPath = deps.hookSettingsPath(sessionId, hookToken)
  if (hookToken !== null && hookSettingsPath === null && bridgePluginDir === null) {
    deps.hookChannel.revoke(sessionId)
  }

  // Composed in claudeBin.ts. Name-sync adds `-n <name>` so claude runs under the operator's
  // name instead of generating its own title, `--settings <file>` carries the hook block
  // WITHOUT touching the operator's project, and `--append-system-prompt` injects the
  // deterministic-attention question-format nudge (DA-4; probe-verified GO), plus the task
  // block of a session started from goal tasks and, for a session without recall, the memory
  // index, with each server's `--mcp-config` file and tools, and one `--plugin-dir` per mod
  // (the bridge mod first, then `watcher-memory` when the session gets recall).
  // Run by `loginShellRun`: a non-POSIX login shell (fish) never parses it.
  const run = loginShellRun(
    deps.shell,
    composeClaudeCommand({
      claudeCommand: request.claudeCommand,
      sessionId,
      displayName: request.displayName,
      hookSettingsPath,
      ...extras.fields,
      model: request.flags.model,
      permissionMode: request.flags.permissionMode,
      effort: request.flags.effort,
      // The programmatic API threads the template's filled-in prompt through here (it rode
      // the durable launch recipe from `launchService.launch`); the in-app launch flows carry
      // none, so for them the composed command stays byte-identical to before.
      initialPrompt: request.initialPrompt,
      // Past sessions (D-1) — a resume composes `claude --resume <id>` instead (claudeBin.ts
      // keeps `-n` (R3) and drops the template flags and the positional prompt for that form).
      resume: request.resume
    })
  )
  return { file: deps.shell, args: run.args, env: { ...extras.env, ...run.env } }
}
