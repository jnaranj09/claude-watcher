// What memory adds to a launch (spec 2026-11-11 memory, "Claude integration"), and the memory MCP
// server the launched session calls.
//
// `memorySpawnExtras` runs inside every actual spawn (`rawClaudeSpawn`, ipc/registerLaunchIpc.ts).
// With memory on, the hook port ours (SEC-6: the server lives on it) and the database open, the
// session gets its own bearer token, a `--mcp-config` file for `claude-watcher-memory`, the six
// tools pre-allowed, the index for its folder appended to its system prompt, and one env var that
// lets an operator's own hooks tell. All of it or nothing: a memory failure never fails a launch;
// the session starts as if memory were off, with a code logged. claude's own auto memory is not
// set here: it has its own setting, applied to every launch in `pty/spawnExtras.ts`.
//
// The memory server's tokens are its own (`createSessionTokens`), so a memory bearer opens nothing
// on `/mcp/goals` and a goals bearer nothing on `/mcp/memory`. Its config files share the goals
// server's `<userData>/mcp/` folder, and the goals instance's one start sweep clears both, so this
// instance has no `clearStale` (a second sweep could only delete live files).
//
// The `/clear` rebind and the card drop live in `window/cardState.ts`; a removed past record
// forgets the session's save and marks its items and commands `Session deleted`
// (`markSessionsDeletedInMemory`). Memory text never reaches
// a log here: lines carry `code=` only.
import type { Session } from '../../shared/schemas/session'
import type { StorageProblemCode } from '../../shared/schemas/storageHealth'
import { createMcpConfigs, grantMcpConfig, type McpConfigs } from '../goals/mcp/mcpConfigFile'
import { createMcpEndpoint, type McpEndpoint } from '../mcp/mcpEndpoint'
import { createSessionTokens, type SessionTokens } from '../mcp/sessionTokens'
import type { Extractor } from './extract/extractor'
import type { MemoryActivityLog } from './memoryActivity'
import type { MemoryCommands } from './memoryCommands'
import { buildMemoryIndex } from './memoryIndex'
import type { MemoryStore } from './memoryStore'
import {
  MEMORY_MCP_SERVER_NAME,
  MEMORY_TOOLS,
  createMemoryTools,
  type MemoryGrant,
  type MemorySessionMeta
} from './memoryTools'

const AREA = 'memory'
const LOG_PREFIX = `[claude-watcher][${AREA}]`

/** The env a memory launch gets: a flag for the operator's own hooks. */
const MEMORY_SPAWN_ENV = { CLAUDE_WATCHER_MEMORY: '1' } as const

/** What one spawn gets from memory. `NO_MEMORY_EXTRAS` = nothing, not even the env. */
export interface MemorySpawnExtras {
  appendPrompt: string | null
  mcpConfigPath: string | null
  allowedTools: string | null
  env: Record<string, string>
}

/** Frozen, env included: one write can never turn the env on for a later launch. Every off branch
 *  of `memorySpawnExtras` returns a fresh copy (`noMemory`), so a caller may still write to it. */
export const NO_MEMORY_EXTRAS: Readonly<MemorySpawnExtras> = Object.freeze({
  appendPrompt: null,
  mcpConfigPath: null,
  allowedTools: null,
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
  tokens: Pick<SessionTokens<MemoryGrant>, 'mint' | 'revoke'>
  configs: Pick<McpConfigs, 'write' | 'remove'>
  /** `MEMORY_MCP_URL`. */
  url: string
  activity: Pick<MemoryActivityLog, 'injected'>
  /** Code-only log sink. */
  log: (line: string) => void
}

/**
 * The memory part of ONE spawn of `sessionId`, in `launch.cwd` for `launch.workspaceId`.
 * `previousSessionId` is the id this terminal's last spawn minted (a Reopen replaces it): its
 * token and file go first, whether or not memory is still on. The whole body is guarded: any throw
 * (a getter, an unreadable index, the activity record) leaves no token or file of `sessionId`
 * behind, logs `code=memory_launch_failed`, and launches the session as if memory were off.
 */
export function memorySpawnExtras(
  deps: MemorySpawnDeps,
  sessionId: string,
  launch: { cwd: string; workspaceId: string },
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
    const index = buildMemoryIndex(store.indexRows(launch.workspaceId, launch.cwd))
    const path = grantMcpConfig(deps, AREA, { sessionId })
    if (path === null) return noMemory()
    deps.activity.injected(sessionId, { chars: index.text.length, itemIds: index.itemIds })
    return {
      appendPrompt: index.text,
      mcpConfigPath: path,
      allowedTools: MEMORY_ALLOWED,
      env: { ...MEMORY_SPAWN_ENV }
    }
  } catch {
    deps.tokens.revoke(sessionId)
    deps.configs.remove(sessionId)
    deps.log(`${LOG_PREFIX} code=memory_launch_failed`)
    return noMemory()
  }
}

/** The memory MCP server: its tokens, its config files and its endpoint (`MEMORY_MCP_PATH`). */
export interface MemoryMcp {
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
    })
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
    memoryStep(log, 'memory_mark_deleted_failed', () =>
      memory.commands()?.markSessionDeleted(sessionId, memory.now())
    )
  }
}
