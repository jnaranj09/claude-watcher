// What one spawn adds to the claude command from goals (`goals/goalLaunch.ts`) and memory
// (`memory/memoryLaunch.ts`) together. claude takes ONE `--append-system-prompt`, and one
// `--mcp-config` flag followed by a file per server (probed on claude 2.1.322: both servers
// connect), so the two are joined here: the question nudge, the task block, then the memory index;
// the goals file first; one comma-joined `--allowedTools`. The env is not a command field: the
// spawn copies memory's onto the child env (`rawClaudeSpawn`).
import { QUESTION_FORMAT_PROMPT, type ClaudeCommandSpec } from './claudeBin'
import { joinSystemPrompt } from '../goals/goalPrompt'
import type { GoalSpawnExtras } from '../goals/goalLaunch'
import type { MemorySpawnExtras } from '../memory/memoryLaunch'

export function spawnCommandFields(
  goal: GoalSpawnExtras,
  memory: MemorySpawnExtras
): Pick<ClaudeCommandSpec, 'appendSystemPrompt' | 'mcpConfigPaths' | 'allowedTools'> {
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
