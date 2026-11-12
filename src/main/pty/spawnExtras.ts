// What one spawn adds to the claude command and its env from goals (`goals/goalLaunch.ts`) and
// memory (`memory/memoryLaunch.ts`) together. claude takes ONE `--append-system-prompt`, and one
// `--mcp-config` flag followed by a file per server (probed on claude 2.1.322: both servers
// connect), so the two are joined here: the question nudge, the task block, then the memory index;
// the goals file first; one comma-joined `--allowedTools`. The child env is the base env plus
// memory's (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_WATCHER_MEMORY`), so memory on turns
// claude's own auto memory off for that launch and memory off leaves it on. `rawClaudeSpawn`
// (`ipc/registerLaunchIpc.ts`) spawns with exactly what this returns.
import { QUESTION_FORMAT_PROMPT, type ClaudeCommandSpec } from './claudeBin'
import { joinSystemPrompt } from '../goals/goalPrompt'
import type { GoalSpawnExtras } from '../goals/goalLaunch'
import type { MemorySpawnExtras } from '../memory/memoryLaunch'

type SpawnCommandFields = Pick<
  ClaudeCommandSpec,
  'appendSystemPrompt' | 'mcpConfigPaths' | 'allowedTools'
>

function spawnCommandFields(goal: GoalSpawnExtras, memory: MemorySpawnExtras): SpawnCommandFields {
  const paths = [goal.mcpConfigPath, memory.mcpConfigPath].filter((p): p is string => p !== null)
  const tools = [goal.allowedTools, memory.allowedTools].filter((t): t is string => t !== null)
  return {
    appendSystemPrompt: joinSystemPrompt(
      QUESTION_FORMAT_PROMPT,
      goal.appendPrompt,
      memory.appendPrompt
    ),
    mcpConfigPaths: paths,
    allowedTools: tools.length === 0 ? null : tools.join(',')
  }
}

/** Asks memory for the launch's folder and workspace (main's active one when the launch names
 *  none), then joins it with goals. `env` is not changed: the result holds a new one. */
export function spawnExtras(input: {
  goal: GoalSpawnExtras
  memory: (target: { cwd: string; workspaceId: string }) => MemorySpawnExtras
  launch: { cwd: string; workspaceId: string | null }
  activeWorkspaceId: () => string
  env: Readonly<Record<string, string>>
}): { fields: SpawnCommandFields; env: Record<string, string> } {
  const { goal, launch } = input
  const memory = input.memory({
    cwd: launch.cwd,
    workspaceId: launch.workspaceId ?? input.activeWorkspaceId()
  })
  return { fields: spawnCommandFields(goal, memory), env: { ...input.env, ...memory.env } }
}
