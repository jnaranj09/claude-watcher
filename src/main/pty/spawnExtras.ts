// What one spawn adds to the claude command and its env from goals (`goals/goalLaunch.ts`) and
// memory (`memory/memoryLaunch.ts`) together. claude takes ONE `--append-system-prompt`, and one
// `--mcp-config` flag followed by a file per server (probed on claude 2.1.322: both servers
// connect), so the two are joined here: the question nudge, the task block, then the memory index
// (which leaves out the tasks the block lists);
// the goals file first; one comma-joined `--allowedTools`; the mod folders, the bridge mod's
// first, one `--plugin-dir` each. The child env is the base env plus
// memory's (`CLAUDE_WATCHER_MEMORY`, only while memory is on) plus what the `Claude's auto
// memory` setting asks for (`AUTO_MEMORY_ENV`), which does not depend on memory being on.
// The launch path (`claudeSpawnCommand`, `pty/claudeSpawnCommand.ts`, called by `rawClaudeSpawn`)
// spawns with exactly what this returns.
import type { ClaudeAutoMemory } from '../../shared/schemas/settings'
import { QUESTION_FORMAT_PROMPT, type ClaudeCommandSpec } from './claudeBin'
import { joinSystemPrompt } from '../goals/goalPrompt'
import type { GoalSpawnExtras } from '../goals/goalLaunch'
import type { MemorySpawnExtras } from '../memory/memoryLaunch'

type SpawnCommandFields = Pick<
  ClaudeCommandSpec,
  'appendSystemPrompt' | 'mcpConfigPaths' | 'allowedTools' | 'pluginDirs'
>

/** claude's own auto memory, per launch (`settings.claudeAutoMemory`). claude reads
 *  `CLAUDE_CODE_DISABLE_AUTO_MEMORY`: `1` turns it off, `0` forces it on over the operator's own
 *  `autoMemoryEnabled: false`, and with the variable left as the app's own env has it, claude's
 *  settings decide (all three probed on claude 2.1.322 with that setting off: `1` and unset gave
 *  no auto memory, `0` gave it). */
const AUTO_MEMORY_ENV: Readonly<Record<ClaudeAutoMemory, Readonly<Record<string, string>>>> = {
  off: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
  on: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' },
  claude: {}
}

function spawnCommandFields(
  goal: GoalSpawnExtras,
  memory: MemorySpawnExtras,
  bridgePluginDir: string | null
): SpawnCommandFields {
  const paths = [goal.mcpConfigPath, memory.mcpConfigPath].filter((p): p is string => p !== null)
  const tools = [goal.allowedTools, memory.allowedTools].filter((t): t is string => t !== null)
  return {
    appendSystemPrompt: joinSystemPrompt(
      QUESTION_FORMAT_PROMPT,
      goal.appendPrompt,
      memory.appendPrompt
    ),
    mcpConfigPaths: paths,
    allowedTools: tools.length === 0 ? null : tools.join(','),
    pluginDirs: bridgePluginDir === null ? [] : [bridgePluginDir]
  }
}

/** Asks memory for the launch's folder and workspace (main's active one when the launch names
 *  none), leaving out of its index the tasks the goal block already lists, then joins it with
 *  goals. `env` is not changed: the result holds a new one, with the
 *  auto memory choice last (it is the operator's setting, so nothing before it wins). */
export function spawnExtras(input: {
  goal: GoalSpawnExtras
  memory: (target: {
    cwd: string
    workspaceId: string
    excludeTaskIds: readonly string[]
  }) => MemorySpawnExtras
  launch: { cwd: string; workspaceId: string | null }
  activeWorkspaceId: () => string
  /** `settings.claudeAutoMemory`, read at this spawn. */
  autoMemory: ClaudeAutoMemory
  env: Readonly<Record<string, string>>
  /** The bridge mod's folder (`applyBridgeMod`), or null when the spawn skips the mod. */
  bridgePluginDir: string | null
}): { fields: SpawnCommandFields; env: Record<string, string> } {
  const { goal, launch } = input
  const memory = input.memory({
    cwd: launch.cwd,
    workspaceId: launch.workspaceId ?? input.activeWorkspaceId(),
    excludeTaskIds: goal.taskIds
  })
  return {
    fields: spawnCommandFields(goal, memory, input.bridgePluginDir),
    env: { ...input.env, ...memory.env, ...AUTO_MEMORY_ENV[input.autoMemory] }
  }
}
