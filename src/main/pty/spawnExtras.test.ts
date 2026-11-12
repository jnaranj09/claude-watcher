// What a spawn adds to the claude command from goals and memory together: one system prompt (the
// question nudge, then the task block, then the memory index), one `--mcp-config` flag with each
// server's file (goals first) and one comma-joined `--allowedTools`.
import { describe, it, expect } from 'vitest'
import { composeClaudeCommand, QUESTION_FORMAT_PROMPT } from './claudeBin'
import { spawnCommandFields } from './spawnExtras'
import { NO_MEMORY_EXTRAS, type MemorySpawnExtras } from '../memory/memoryLaunch'
import type { GoalSpawnExtras } from '../goals/goalLaunch'

const goal: GoalSpawnExtras = {
  appendPrompt: 'TASK BLOCK',
  mcpConfigPath: '/ud/mcp/goals.json',
  allowedTools: 'mcp__claude-watcher__mark_task_done'
}
const NO_GOAL: GoalSpawnExtras = { appendPrompt: null, mcpConfigPath: null, allowedTools: null }
const memory: MemorySpawnExtras = {
  appendPrompt: 'MEMORY INDEX',
  mcpConfigPath: '/ud/mcp/memory.json',
  allowedTools: 'mcp__claude-watcher-memory__memory_search,mcp__claude-watcher-memory__memory_get',
  env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_WATCHER_MEMORY: '1' }
}

const base = {
  claudeCommand: 'claude',
  sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
  displayName: 'x',
  hookSettingsPath: null,
  model: null,
  permissionMode: null,
  effort: null,
  initialPrompt: null,
  resume: false,
  pluginDir: null
}

describe('spawnCommandFields', () => {
  it('joins goals and memory into one prompt, two config paths and one tool list', () => {
    expect(spawnCommandFields(goal, memory)).toEqual({
      appendSystemPrompt: `${QUESTION_FORMAT_PROMPT}\n\nTASK BLOCK\n\nMEMORY INDEX`,
      mcpConfigPaths: ['/ud/mcp/goals.json', '/ud/mcp/memory.json'],
      allowedTools: `mcp__claude-watcher__mark_task_done,${memory.allowedTools ?? ''}`
    })
  })

  it('hands the task block, its config and its tool on when memory adds nothing', () => {
    expect(spawnCommandFields(goal, NO_MEMORY_EXTRAS)).toEqual({
      appendSystemPrompt: `${QUESTION_FORMAT_PROMPT}\n\nTASK BLOCK`,
      mcpConfigPaths: ['/ud/mcp/goals.json'],
      allowedTools: 'mcp__claude-watcher__mark_task_done'
    })
  })

  it('hands memory on alone for a launch that is not from tasks', () => {
    expect(spawnCommandFields(NO_GOAL, memory)).toEqual({
      appendSystemPrompt: `${QUESTION_FORMAT_PROMPT}\n\nMEMORY INDEX`,
      mcpConfigPaths: ['/ud/mcp/memory.json'],
      allowedTools: memory.allowedTools
    })
  })

  it('nothing from either gives the question prompt alone and no MCP flag in the command', () => {
    const fields = spawnCommandFields(NO_GOAL, NO_MEMORY_EXTRAS)
    expect(fields).toEqual({
      appendSystemPrompt: QUESTION_FORMAT_PROMPT,
      mcpConfigPaths: [],
      allowedTools: null
    })
    const bare = composeClaudeCommand({ ...base, ...fields })
    expect(bare).not.toContain('--mcp-config')
    expect(bare).not.toContain('--allowedTools')
  })

  it('the command carries one --mcp-config flag followed by both files, and both tool lists', () => {
    const full = composeClaudeCommand({ ...base, ...spawnCommandFields(goal, memory) })
    expect(full.match(/--mcp-config/g)).toHaveLength(1)
    expect(full).toContain('/ud/mcp/goals.json')
    expect(full).toContain('/ud/mcp/memory.json')
    expect(full).toContain('--allowedTools')
    expect(full).toContain('mcp__claude-watcher-memory__memory_get')
    expect(full).toContain('MEMORY INDEX')
  })
})
