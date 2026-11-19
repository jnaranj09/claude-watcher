// Memory's task writes and the session's memory goal (spec 2026-11-18 memory session goals): a
// session's first task makes its goal, later saves reuse it, an update records a touch. Real
// `:memory:` store, commands and state; a real goals store on an in-memory blob.
import { beforeEach, describe, expect, it } from 'vitest'
import { createGoalsStore, type GoalsStore } from '../../persistence/goals'
import { createMemoryCommands } from '../memoryCommands'
import { openMemoryDb } from '../memoryDb'
import { createMemoryStore } from '../memoryStore'
import { applyChunk, type ApplyDeps, type ChunkWrite } from './applyChunk'
import type { Checked } from './checkCandidates'
import { createExtractState, type ExtractRow, type ExtractState } from './extractState'

const NOW = 1_762_800_000_000
const META: ExtractRow['meta'] = {
  folder: '/work/acme/shop',
  sessionName: 'fix api port',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

let ids: number
let lines: string[]
let state: ExtractState
let goals: GoalsStore
let deps: ApplyDeps

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  ids = 0
  lines = []
  const log = (line: string): void => {
    lines.push(line)
  }
  state = createExtractState({ db: open.db })
  goals = createGoalsStore({ newId: () => `g${++ids}`, now: () => NOW, log: () => undefined })
  deps = {
    store: createMemoryStore({
      db: open.db,
      now: () => NOW,
      newId: () => `m${++ids}`,
      report: () => undefined,
      log
    }),
    commands: createMemoryCommands({ db: open.db, newId: () => `c${++ids}` }),
    state,
    goals,
    now: () => NOW,
    log
  }
})

function track(
  sessionId = 't-1',
  originSessionId = 'card-1',
  meta: ExtractRow['meta'] = META
): ExtractRow {
  return state.track({
    sessionId,
    originSessionId,
    workspaceId: 'w1',
    meta,
    phase: 'live',
    at: NOW
  })
}

function write(row: ExtractRow, kept: Checked[], offset = 400): ChunkWrite {
  return {
    row,
    transcriptPath: '/tmp/transcripts/t.jsonl',
    kept,
    note: null,
    commands: [],
    entries: [],
    next: { byteOffset: offset, entryCount: 9, prompts: 2 }
  }
}

type TaskCandidate = Extract<Checked, { kind: 'task' }>

function add(title: string): TaskCandidate {
  return {
    kind: 'task',
    action: 'add',
    id: null,
    title,
    check: null,
    leftWith: 'operator',
    basis: 'observed'
  }
}

describe("a memory task and the session's goal", () => {
  it("a plain session's first task creates the goal and logs it", () => {
    applyChunk(deps, write(track(), [add('Restart the API')]))
    const [goal] = goals.view().goals
    expect(goals.view().goals).toHaveLength(1)
    expect(goal).toMatchObject({
      workspaceId: 'w1',
      name: 'fix api port',
      defaultCwd: '/work/acme/shop',
      memorySessionIds: ['card-1']
    })
    expect(goals.view().tasks).toEqual([
      expect.objectContaining({
        goalId: goal?.id,
        sessionIds: [],
        touchedBy: [{ sessionId: 'card-1', at: NOW }]
      })
    ])
    expect(lines).toEqual([
      '[claude-watcher][memory] code=memory_goal_created folder=yes memory_goals=1'
    ])
  })

  it('two chunks of one job make one goal', () => {
    const row = track()
    applyChunk(deps, write(row, [add('Restart the API')]))
    applyChunk(deps, write(row, [add('Rebuild the index')], 800))
    expect(goals.view().goals).toHaveLength(1)
    expect(new Set(goals.view().tasks.map((t) => t.goalId)).size).toBe(1)
    expect(lines).toHaveLength(1)
  })

  it('a null folder makes a goal with no folder, and logs folder=no', () => {
    applyChunk(deps, write(track('t-1', 'card-1', { ...META, folder: null }), [add('Restart')]))
    expect(goals.view().goals[0]?.defaultCwd).toBeNull()
    expect(lines).toEqual([
      '[claude-watcher][memory] code=memory_goal_created folder=no memory_goals=1'
    ])
  })

  it('an update records the touch', () => {
    const row = track()
    applyChunk(deps, write(row, [add('Restart the API')]))
    const id = goals.view().tasks[0]?.id ?? ''
    const later = { ...deps, now: () => NOW + 50 }
    const update: Checked = { ...add('Restart the API'), action: 'update', id }
    applyChunk(later, write(track('t-2', 'card-2'), [update], 800))
    expect(goals.view().tasks[0]?.touchedBy).toEqual([
      { sessionId: 'card-1', at: NOW },
      { sessionId: 'card-2', at: NOW + 50 }
    ])
  })

  it('/clear between two jobs keeps one goal', () => {
    applyChunk(deps, write(track(), [add('Restart the API')]))
    goals.rebindSession('card-1', 'card-2')
    applyChunk(deps, write(track('t-2', 'card-2'), [add('Rebuild the index')]))
    expect(goals.view().goals).toHaveLength(1)
    expect(goals.view().goals[0]?.memorySessionIds).toEqual(['card-1', 'card-2'])
    expect(new Set(goals.view().tasks.map((t) => t.goalId)).size).toBe(1)
  })
})
