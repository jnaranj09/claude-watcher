// A whole extractor over a real `:memory:` store, commands, state and goals store, with fake
// transcripts, a fake model call that answers from a script (or waits, in manual mode), a
// hand-driven clock and recorded pushes, records and logs. Shared by the extractor's two test
// files. Synthetic text only; never shipped.
import { vi, type Mock } from 'vitest'
import type { MemoryExtractResult } from '../shared/schemas/memory'
import type { ExtractCandidate } from '../shared/schemas/memoryExtract'
import type { PastSessionMemory } from '../shared/schemas/pastSession'
import type { MemoryCheckpoint } from '../shared/schemas/settings'
import { TranscriptEntrySchema } from '../shared/schemas/transcriptEntry'
import { createGoalsStore, type GoalsStore } from '../main/persistence/goals'
import { createMemoryActivity, type MemoryActivityLog } from '../main/memory/memoryActivity'
import { createMemoryCommands, type MemoryCommands } from '../main/memory/memoryCommands'
import { openMemoryDb, type MemoryDb } from '../main/memory/memoryDb'
import { createMemoryStore, type MemoryStore } from '../main/memory/memoryStore'
import type { MemorySessionMeta } from '../main/memory/memoryTools'
import { createExtractState, type ExtractState } from '../main/memory/extract/extractState'
import {
  createExtractor,
  type Extractor,
  type ExtractorDeps
} from '../main/memory/extract/extractor'
import type { ExtractCallResult } from '../main/memory/extract/headlessClaude'
import type { ReadLine } from '../main/memory/extract/transcriptReader'

export const T0 = 1_762_800_000_000

export const META: MemorySessionMeta = {
  workspaceId: 'w1',
  folder: '/work/acme/shop',
  sessionName: 'fix api port',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

export type FakeCall = {
  input: string
  resolve: (r: ExtractCallResult) => void
  cancel: Mock<() => void>
  killNow: Mock<() => void>
}

export const answer = (
  candidates: ExtractCandidate[],
  note = 'worked on the api'
): ExtractCallResult => ({
  ok: true,
  output: { candidates, note }
})
export const failure = (
  reason: Exclude<ExtractCallResult, { ok: true }>['reason'] = 'exit'
): ExtractCallResult => ({ ok: false, reason, issue: null })

export interface Harness {
  ex: Extractor
  db: MemoryDb
  store: MemoryStore
  state: ExtractState
  commands: MemoryCommands
  goals: GoalsStore
  activity: MemoryActivityLog
  /** Live settings and seams: change them between steps. */
  set: {
    enabled: boolean
    checkpoint: MemoryCheckpoint
    tasksOn: boolean
    version: boolean
    /** Manual mode: calls wait for `calls[i].resolve`. Else each answers at once from `answers`
     *  (an empty answer when the script is out). */
    manual: boolean
    /** Lines one read returns at most (then `more: true`); null = all. */
    linesPerRead: number | null
    memoryOpen: boolean
    goalsOpen: boolean
    /** What `push` answers: false = a result nothing took (invalid). Taken results are `pushed`. */
    pushTaken: boolean
  }
  meta: Map<string, MemorySessionMeta>
  transcripts: Map<string, ReadLine[]>
  answers: ExtractCallResult[]
  calls: FakeCall[]
  reads: { path: string; from: number; max: number }[]
  versionOk: Mock<() => boolean>
  setMemory: Mock<(id: string, memory: PastSessionMemory) => void>
  pushed: MemoryExtractResult[]
  /** Every `push` call, taken or not. */
  pushTries: { count: number }
  logs: string[]
  clock: { now: number }
  /** Appends lines to a session's transcript (each line 100 bytes on from the last). */
  write(sessionId: string, ...lines: Record<string, unknown>[]): void
  /** A second extractor over the same database and seams (a new app start). */
  restart(): Extractor
  deps: ExtractorDeps
}

let uuids = 0
export const prompt = (text: string): Record<string, unknown> => ({
  type: 'user',
  uuid: `p-${++uuids}`,
  promptSource: 'typed',
  message: { content: text }
})
export const said = (text: string): Record<string, unknown> => ({
  type: 'assistant',
  uuid: `a-${++uuids}`,
  message: { content: [{ type: 'text', text }] }
})
export const bashCall = (id: string, command: string): Record<string, unknown> => ({
  type: 'assistant',
  uuid: `c-${++uuids}`,
  message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] }
})
export const bashResult = (id: string, text: string): Record<string, unknown> => ({
  type: 'user',
  uuid: `r-${++uuids}`,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] }
})
/** A line with no conversation entry. */
export const noise = (): Record<string, unknown> => ({ type: 'system', uuid: `s-${++uuids}` })

export function createHarness(): Harness {
  const open = openMemoryDb(':memory:', { now: () => T0, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  const db = open.db
  let ids = 0
  const logs: string[] = []
  const clock = { now: T0 }
  const now = (): number => clock.now
  const store = createMemoryStore({
    db,
    now,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: (line) => logs.push(line)
  })
  const commands = createMemoryCommands({ db, newId: () => `c${++ids}` })
  const state = createExtractState({ db, log: (line) => logs.push(line) })
  const goals = createGoalsStore({ newId: () => `g${++ids}`, now, log: () => undefined })
  const activity = createMemoryActivity(() => undefined)
  const set: Harness['set'] = {
    enabled: true,
    checkpoint: 15,
    tasksOn: true,
    version: true,
    manual: false,
    linesPerRead: null,
    memoryOpen: true,
    goalsOpen: true,
    pushTaken: true
  }
  const meta = new Map<string, MemorySessionMeta>()
  const transcripts = new Map<string, ReadLine[]>()
  const answers: ExtractCallResult[] = []
  const calls: FakeCall[] = []
  const reads: Harness['reads'] = []
  const pushed: MemoryExtractResult[] = []
  const pushTries = { count: 0 }
  const versionOk = vi.fn(() => set.version)
  const setMemory = vi.fn<(id: string, memory: PastSessionMemory) => void>()

  const deps: ExtractorDeps = {
    enabled: () => set.enabled,
    checkpoint: () => set.checkpoint,
    tasksOn: () => set.tasksOn,
    model: () => 'sonnet',
    memory: () => (set.memoryOpen ? { store, commands, state } : null),
    goals: () => (set.goalsOpen ? goals : null),
    sessionMeta: (id) => meta.get(id) ?? null,
    locate: (id) => (transcripts.has(id) ? `/transcripts/${id}.jsonl` : null),
    size: (path) => {
      const id = /([^/]+)\.jsonl$/.exec(path)?.[1] ?? ''
      return transcripts.get(id)?.at(-1)?.end ?? null
    },
    read: (path, from, max) => {
      reads.push({ path, from, max })
      const id = /([^/]+)\.jsonl$/.exec(path)?.[1] ?? ''
      const all = (transcripts.get(id) ?? []).filter((l) => l.end > from)
      const lines = set.linesPerRead === null ? all : all.slice(0, set.linesPerRead)
      return Promise.resolve({
        lines,
        nextOffset: lines.at(-1)?.end ?? from,
        more: lines.length < all.length
      })
    },
    versionOk,
    call: (_model, input) => {
      let resolve: (r: ExtractCallResult) => void = () => undefined
      const result = new Promise<ExtractCallResult>((r) => {
        resolve = r
      })
      const fake: FakeCall = { input, resolve, cancel: vi.fn(), killNow: vi.fn() }
      calls.push(fake)
      if (!set.manual) resolve(answers.shift() ?? answer([]))
      return { result, cancel: fake.cancel, killNow: fake.killNow }
    },
    pastSessions: () => ({ setMemory }),
    activity,
    push: (r) => {
      pushTries.count += 1
      if (set.pushTaken) pushed.push(r)
      return set.pushTaken
    },
    now,
    log: (line) => logs.push(line)
  }

  return {
    ex: createExtractor(deps),
    db,
    store,
    state,
    commands,
    goals,
    activity,
    set,
    meta,
    transcripts,
    answers,
    calls,
    reads,
    versionOk,
    setMemory,
    pushed,
    pushTries,
    logs,
    clock,
    deps,
    write: (sessionId, ...raws) => {
      const lines = transcripts.get(sessionId) ?? []
      for (const raw of raws) {
        const end = (lines.at(-1)?.end ?? 0) + 100
        lines.push({ entry: TranscriptEntrySchema.parse(raw), end })
      }
      transcripts.set(sessionId, lines)
    },
    restart: () => createExtractor(deps)
  }
}

/** A launched session on the board, with `Stop`s up to its first checkpoint. */
export function stops(h: Harness, sessionId: string, n: number): void {
  for (let i = 0; i < n; i += 1) h.ex.stop(sessionId)
}

/** Lets every pending promise step run (the fake call and read resolve on a microtask; a
 *  macrotask runs only after all of them). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
