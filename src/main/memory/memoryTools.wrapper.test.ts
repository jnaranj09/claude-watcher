// P3-C15 for the memory tools: a result's own punctuation after a saved text (the browse line's
// `: `) can never complete the memory block marker. Own file: memoryTools.test.ts is at its line
// cap. Real `:memory:` store; the session and name lookups are stand-ins.
import { describe, expect, it } from 'vitest'
import type { McpToolOutcome } from '../mcp/mcpEndpoint'
import { createMemoryActivity } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore } from './memoryStore'
import { createMemoryTools, type MemorySessionMeta } from './memoryTools'

const NOW = 1_762_800_000_000

const SESSION: MemorySessionMeta = {
  workspaceId: 'w1',
  folder: '/work/app',
  sessionName: 'build',
  tagIds: ['t1'],
  templateId: null,
  goalId: null,
  taskIds: []
}

function toolsNamingTag(tagName: string): (name: string, args: unknown) => McpToolOutcome {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  let n = 0
  const store = createMemoryStore({
    db: open.db,
    now: () => NOW,
    newId: () => `m${++n}`,
    report: () => undefined,
    log: () => undefined
  })
  const tools = createMemoryTools({
    enabled: () => true,
    store: () => store,
    session: (id) => (id === 's1' ? SESSION : null),
    names: {
      tagIdsByName: () => [],
      tagName: () => tagName,
      goalIdsByName: () => [],
      goalName: () => null
    },
    tasks: () => null,
    commands: () => null,
    activity: createMemoryActivity(),
    now: () => NOW,
    log: () => undefined
  })
  return (name, args) => tools.call(name, args, { sessionId: 's1' })
}

describe('memory tools: P3-C15', () => {
  it('a tag named like the marker cannot complete it at the start of a browse line', () => {
    const call = toolsNamingTag('Memory (Claude Watcher)')
    call('memory_save', { kind: 'specific', key: 'k', value: 'v', scope: 'workspace' })
    expect(call('memory_browse', { by: 'tag' })).toEqual({
      kind: 'result',
      text: 'Memory (Claude Watcher)꞉ 1',
      isError: false
    })
  })
})
