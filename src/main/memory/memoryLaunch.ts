// What memory adds to a launch (spec 2026-11-11 memory, "Claude integration"), and the memory MCP
// server the launched session calls.
//
// `memorySpawnExtras` runs inside every actual spawn (`rawClaudeSpawn`, ipc/registerLaunchIpc.ts).
// With memory on, the hook port ours (SEC-6: the server lives on it) and the database open, the
// session gets its own bearer token, a `--mcp-config` file for `claude-watcher-memory`, the memory
// tools pre-allowed (`MEMORY_TOOLS`), and one env var that lets an operator's own hooks tell. Then
// one choice (`recallMod`, mods/memoryModSpawn.ts, memory phase 3 addendum §2): the `watcher-memory`
// mod (`--plugin-dir`, and `MEMORY_CONFIG_ENV` naming the config file, where the mod reads the link
// to main and this session's token), which sends the index and recall while the session runs; or
// phase 1, the index for its folder (its open tasks, its keys grouped by the task, goal and folder
// it shares with them, and its recent sessions) appended to its system prompt. Either way the choice is recorded for Context (`activity.recallMode`). All of it
// or nothing: a memory failure never fails a launch;
// the session starts as if memory were off, with a code logged. claude's own auto memory is not
// set here: it has its own setting, applied to every launch in `pty/spawnExtras.ts`.
//
// The memory server's tokens are its own (`createSessionTokens`), so a memory bearer opens nothing
// on `/mcp/goals` and a goals bearer nothing on `/mcp/memory`. Its config files share the goals
// server's `<userData>/mcp/` folder, and the goals instance's one start sweep clears both, so this
// instance has no `clearStale` (a second sweep could only delete live files). The same tokens open
// the `watcher-memory` mod's routes (`modMemoryWiring.ts`), built here so no caller can pair them
// with another server's tokens.
//
// The `/clear` rebind and the card drop live in `window/cardState.ts`; a removed past record
// forgets the session's save and marks its items and commands `Session deleted`
// (`markSessionsDeletedInMemory`). Memory text never reaches
// a log here: lines carry `code=` only.
import type { GoalsView } from '../../shared/schemas/goal'
import type { Session } from '../../shared/schemas/session'
import type { StorageProblemCode } from '../../shared/schemas/storageHealth'
import { createMcpConfigs, grantMcpConfig, type McpConfigs } from '../goals/mcp/mcpConfigFile'
import { createMcpEndpoint, type McpEndpoint } from '../mcp/mcpEndpoint'
import { createSessionTokens, type SessionTokens } from '../mcp/sessionTokens'
import type { MemoryRecallMod } from '../mods/memoryModSpawn'
import type { Extractor } from './extract/extractor'
import type { MemoryActivityLog } from './memoryActivity'
import type { MemoryCommands } from './memoryCommands'
import type { MemoryNames } from './memoryNames'
import type { MemoryRecall } from './memoryRecall'
import type { MemoryStore } from './memoryStore'
import { goalOfTasks } from './memoryTasks'
import {
  MEMORY_MCP_SERVER_NAME,
  MEMORY_TOOLS,
  createMemoryTools,
  type MemoryGrant,
  type MemorySessionMeta
} from './memoryTools'
import { createModMemory, type ModMemory } from './modMemoryWiring'
import { buildSessionIndex } from './sessionIndex'

const AREA = 'memory'
const LOG_PREFIX = `[claude-watcher][${AREA}]`

/** The env a memory launch gets: a flag for the operator's own hooks. */
const MEMORY_SPAWN_ENV = { CLAUDE_WATCHER_MEMORY: '1' } as const

/** The env var that names a mod session's `--mcp-config` file. The mod holds its own copy
 *  (`CONFIG_ENV`, src/mod/watcher-memory/hooks/protocol.ts); `tests/main/modMemoryContract.test.ts`
 *  pins the two together. */
export const MEMORY_CONFIG_ENV = 'CLAUDE_WATCHER_MEMORY_CONFIG'

/** What one spawn gets from memory. `NO_MEMORY_EXTRAS` = nothing, not even the env. */
export interface MemorySpawnExtras {
  appendPrompt: string | null
  mcpConfigPath: string | null
  allowedTools: string | null
  /** The `watcher-memory` mod's folder for `--plugin-dir`, or null (phase 1, or no memory). */
  pluginDir: string | null
  env: Record<string, string>
}

/** Frozen, env included: one write can never turn the env on for a later launch. Every off branch
 *  of `memorySpawnExtras` returns a fresh copy (`noMemory`), so a caller may still write to it. */
export const NO_MEMORY_EXTRAS: Readonly<MemorySpawnExtras> = Object.freeze({
  appendPrompt: null,
  mcpConfigPath: null,
  allowedTools: null,
  pluginDir: null,
  env: Object.freeze({})
})

function noMemory(): MemorySpawnExtras {
  return { ...NO_MEMORY_EXTRAS, env: {} }
}

/** claude names an MCP tool `mcp__<server>__<tool>`; pre-allowed, no tool stops on a permission
 *  prompt (probed on claude 2.1.322). Comma-joined in the one `--allowedTools` value. */
const MEMORY_ALLOWED = MEMORY_TOOLS.map((tool) => `mcp__${MEMORY_MCP_SERVER_NAME}__${tool}`).join(
  ','
)

export interface MemorySpawnDeps {
  /** `settings.memoryEnabled`, read live at each spawn. */
  enabled: () => boolean
  /** SEC-6: the memory server is on the hook listener, so only while THIS process holds it. */
  hookListening: () => boolean
  /** Null while the database is not open (unreadable at start, SMOKE, quitting). */
  store: () => MemoryStore | null
  /** The goals view the index reads the folder's open tasks from; null = no task lines. */
  tasks: () => Pick<GoalsView, 'goals' | 'tasks'> | null
  /** The time the index counts `last seen` days to. */
  now: () => number
  /** The goal and tag names the index's headings print. */
  names: Pick<MemoryNames, 'goalName' | 'tagName'>
  tokens: Pick<SessionTokens<MemoryGrant>, 'mint' | 'revoke'>
  configs: Pick<McpConfigs, 'write' | 'remove'>
  /** `MEMORY_MCP_URL`. */
  url: string
  activity: Pick<MemoryActivityLog, 'injected' | 'recallMode'>
  /** The memory mod or the reason not (`createMemoryModChoice`), asked once the config is written. */
  recallMod: () => MemoryRecallMod
  /** A mod session's recall starts with nothing sent, the goal block's tasks left out, and knows
   *  whether the spawn resumes a conversation (`launch.resume`). */
  recall: Pick<MemoryRecall, 'launched'>
  /** Code-only log sink. */
  log: (line: string) => void
}

/**
 * The memory part of ONE spawn of `sessionId`, in `launch.cwd` for `launch.workspaceId`. The
 * index leaves out `launch.excludeTaskIds` (the tasks the goal block of this spawn lists).
 * `previousSessionId` is the id this terminal's last spawn minted (a Reopen replaces it): its
 * token and file go first, whether or not memory is still on. Once the config is written, a mod
 * session gets no index on its command line (the mod sends it) and phase 1 gets the index; the
 * recall mode is recorded either way. The whole body is guarded: any throw (a getter, an
 * unreadable index, the activity record, the recall service) leaves no token or file of
 * `sessionId` behind, logs `code=memory_launch_failed`, and launches the session as if memory were
 * off.
 */
export function memorySpawnExtras(
  deps: MemorySpawnDeps,
  sessionId: string,
  launch: { cwd: string; workspaceId: string; excludeTaskIds: readonly string[]; resume: boolean },
  previousSessionId: string | null
): MemorySpawnExtras {
  try {
    if (previousSessionId !== null) {
      deps.tokens.revoke(previousSessionId)
      deps.configs.remove(previousSessionId)
    }
    const store = deps.store()
    // The hook port down is already on screen (`ServerHealthBanner`): no log per launch.
    if (!deps.enabled() || !deps.hookListening() || store === null) return noMemory()
    const path = grantMcpConfig(deps, AREA, { sessionId })
    if (path === null) return noMemory()
    const mod = deps.recallMod()
    if ('dir' in mod) {
      deps.recall.launched(sessionId, {
        excludeTaskIds: launch.excludeTaskIds,
        resume: launch.resume
      })
      deps.activity.recallMode(sessionId, { mode: 'mod' })
      return {
        appendPrompt: null,
        mcpConfigPath: path,
        allowedTools: MEMORY_ALLOWED,
        pluginDir: mod.dir,
        env: { ...MEMORY_SPAWN_ENV, [MEMORY_CONFIG_ENV]: path }
      }
    }
    // A spawn knows no template and no tags (its card is put on the board after it): the index has
    // no template or tags group. Its goal is the one the goal block's tasks share.
    const view = deps.tasks()
    const index = buildSessionIndex(deps, store, {
      workspaceId: launch.workspaceId,
      context: {
        folder: launch.cwd,
        taskIds: launch.excludeTaskIds,
        goalId: view === null ? null : goalOfTasks(view, launch.excludeTaskIds),
        templateId: null,
        tagIds: []
      },
      excludeTaskIds: launch.excludeTaskIds
    })
    deps.activity.injected(sessionId, { chars: index.text.length, itemIds: index.itemIds })
    deps.activity.recallMode(sessionId, { mode: 'launch', reason: mod.skip })
    return {
      appendPrompt: index.text,
      mcpConfigPath: path,
      allowedTools: MEMORY_ALLOWED,
      pluginDir: null,
      env: { ...MEMORY_SPAWN_ENV }
    }
  } catch {
    deps.tokens.revoke(sessionId)
    deps.configs.remove(sessionId)
    deps.log(`${LOG_PREFIX} code=memory_launch_failed`)
    return noMemory()
  }
}

/** The memory MCP server: its tokens, its config files, its endpoint (`MEMORY_MCP_PATH`), and the
 *  `watcher-memory` mod's recall service and routes behind the same tokens (`modMemoryWiring.ts`). */
export interface MemoryMcp extends ModMemory {
  tokens: SessionTokens<MemoryGrant>
  /** No `clearStale`: the goals instance's start sweep clears this server's files too. */
  configs: Pick<McpConfigs, 'write' | 'rebind' | 'remove'>
  endpoint: McpEndpoint<MemoryGrant>
}

export function createMemoryMcp(
  deps: Parameters<typeof createMemoryTools>[0] & {
    /** `app.getPath('userData')`, read when a file is written. */
    dir: () => string
    /** Storage health's `memory` reporter: a refused config write shows in `StorageNotice`. */
    report: (code: StorageProblemCode) => void
    /** Recall also records what it injected. */
    activity: Pick<MemoryActivityLog, 'injected' | 'record'>
  }
): MemoryMcp {
  const tokens = createSessionTokens<MemoryGrant>()
  const files = createMcpConfigs({
    dir: deps.dir,
    serverName: MEMORY_MCP_SERVER_NAME,
    area: AREA,
    log: deps.log,
    report: deps.report
  })
  return {
    tokens,
    configs: { write: files.write, rebind: files.rebind, remove: files.remove },
    endpoint: createMcpEndpoint({
      tokens,
      tools: createMemoryTools(deps),
      serverName: MEMORY_MCP_SERVER_NAME,
      area: AREA,
      log: deps.log
    }),
    ...createModMemory({ ...deps, tokens })
  }
}

/**
 * The memory tools' view of a live session: its card on whichever board holds it (the folder is
 * the session's working directory) and the tasks linked to it. A goal is named only when every
 * linked task is in that one goal. Null when no board holds the session.
 */
export function liveSessionMeta(source: {
  boards: () => Iterable<{ sessionOf(sessionId: string): Session | undefined }>
  tasksForSession: (sessionId: string) => readonly { id: string; goalId: string | null }[]
}): (sessionId: string) => MemorySessionMeta | null {
  return (sessionId) => {
    let session: Session | undefined
    for (const board of source.boards()) session ??= board.sessionOf(sessionId)
    if (session === undefined) return null
    const tasks = source.tasksForSession(sessionId)
    const goalIds = new Set(tasks.map((t) => t.goalId))
    const [onlyGoal] = goalIds
    return {
      workspaceId: session.workspaceId,
      folder: session.projectPath,
      sessionName: session.sessionName,
      tagIds: [...session.tagIds],
      templateId: session.templateId,
      goalId: goalIds.size === 1 ? (onlyGoal ?? null) : null,
      taskIds: tasks.map((t) => t.id)
    }
  }
}

/** One memory step beside a session-engine step: a throw is logged by code and never reaches the
 *  engine (the store already reported a refused write to storage health). */
export function memoryStep(log: (line: string) => void, code: string, step: () => void): void {
  try {
    step()
  } catch {
    log(`${LOG_PREFIX} code=${code}`)
  }
}

/** Deleted sessions (a past record forgotten, a card deleted, or a record a workspace cascade or
 *  the cap dropped): their save is forgotten first (its job cancelled, its save state deleted:
 *  `forget` learns the jobs from the rows it removes), then their items and the commands they
 *  ran last stay, marked `Session deleted`. Each id and each part is its own step, so one failure
 *  does not stop the rest. A part that is null (memory off) is skipped; never throws. */
export function markSessionsDeletedInMemory(
  memory: {
    store: () => Pick<MemoryStore, 'markSessionDeleted'> | null
    commands: () => Pick<MemoryCommands, 'markSessionDeleted'> | null
    extractor: () => Pick<Extractor, 'forget'> | null
    now: () => number
  },
  sessionIds: readonly string[],
  log: (line: string) => void
): void {
  for (const sessionId of sessionIds) {
    memoryStep(log, 'memory_forget_failed', () => memory.extractor()?.forget(sessionId))
    memoryStep(log, 'memory_mark_deleted_failed', () =>
      memory.store()?.markSessionDeleted(sessionId)
    )
    memoryStep(log, 'memory_mark_commands_deleted_failed', () =>
      memory.commands()?.markSessionDeleted(sessionId, memory.now())
    )
  }
}
