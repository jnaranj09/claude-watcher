// R50: a past session's `memory` state (how saving memory from it went) lives in its own file,
// never inside the `.strict()` record, so the Past sessions file stays one an older build reads.
// Main merges it back when records are read: the store API and the wire record do not change.
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createPastSessionsStore,
  type PastSessionsBlobStore,
  type PastSessionsMemoryBlobStore
} from './pastSessions'
import {
  PAST_SESSIONS_MAX,
  type PastSessionMemory,
  type PastSessionsFile,
  type PastSessionsMemoryFile
} from '../../shared/schemas/pastSession'
import { SessionNameSchema } from '../../shared/schemas/launch'
import { WorkspaceIdSchema } from '../../shared/schemas/workspace'

const ROW = {
  id: 's1',
  name: 'billing api',
  cwd: '/work/api',
  workspaceId: 'default',
  tagIds: [] as string[],
  launchedAt: 100,
  endedAt: 200
}

const SAVED: PastSessionMemory = {
  state: 'saved',
  specifics: 2,
  facts: 1,
  tasks: 0,
  episodes: 1,
  episodeId: 'e1'
}

function fakeBlob<T>(seed?: unknown): {
  blobStore: { read: () => unknown; write: (value: T) => void; backup: () => void }
  current: () => unknown
  backups: () => number
  writes: () => number
} {
  let blob: unknown = seed
  let backups = 0
  let writes = 0
  return {
    blobStore: {
      read: () => blob,
      write: (value: T) => {
        writes++
        blob = value
      },
      backup: () => {
        backups++
      }
    },
    current: () => blob,
    backups: () => backups,
    writes: () => writes
  }
}

function make(
  options: {
    past?: ReturnType<typeof fakeBlob<PastSessionsFile>>
    memory?: ReturnType<typeof fakeBlob<PastSessionsMemoryFile>>
  } & Omit<Parameters<typeof createPastSessionsStore>[0] & object, 'blobStore'> = {}
): {
  store: ReturnType<typeof createPastSessionsStore>
  past: ReturnType<typeof fakeBlob<PastSessionsFile>>
  memory: ReturnType<typeof fakeBlob<PastSessionsMemoryFile>>
} {
  const { past = fakeBlob<PastSessionsFile>(), memory = fakeBlob<PastSessionsMemoryFile>() } =
    options
  const store = createPastSessionsStore({
    ...options,
    blobStore: past.blobStore as PastSessionsBlobStore,
    memoryBlobStore: memory.blobStore as PastSessionsMemoryBlobStore
  })
  return { store, past, memory }
}

const pastFile = (b: { current: () => unknown }): PastSessionsFile =>
  b.current() as PastSessionsFile
const memoryFile = (b: { current: () => unknown }): PastSessionsMemoryFile =>
  b.current() as PastSessionsMemoryFile

describe('past sessions: the memory state file (R50)', () => {
  it('setMemory writes its own file, never the record in the past sessions file', () => {
    const { store, past, memory } = make()
    store.archive(ROW)
    const pastWrites = past.writes()
    store.setMemory(ROW.id, SAVED)
    expect(memoryFile(memory)).toEqual({ version: 1, records: { s1: SAVED } })
    expect(past.writes()).toBe(pastWrites)
    expect(pastFile(past).sessions[0]).not.toHaveProperty('memory')
  })

  it('a read merges the state back: get and list carry `memory` as before', () => {
    const { store } = make()
    store.archive(ROW)
    store.setMemory(ROW.id, SAVED)
    expect(store.get(ROW.id)?.memory).toEqual(SAVED)
    expect(store.list()[0]?.memory).toEqual(SAVED)
  })

  it('a record with no entry has no `memory` key', () => {
    const { store } = make()
    store.archive(ROW)
    expect(store.get(ROW.id)).not.toHaveProperty('memory')
  })

  it('the next start reads the state back from its file', () => {
    const { store, past, memory } = make()
    store.archive(ROW)
    store.setMemory(ROW.id, SAVED)
    const next = make({ past, memory }).store
    expect(next.get(ROW.id)?.memory).toEqual(SAVED)
  })

  it('a later archive and a markLive of the same id keep the state', () => {
    const { store, past } = make()
    store.archive(ROW)
    store.setMemory(ROW.id, SAVED)
    store.markLive(ROW)
    store.archive({ ...ROW, endedAt: 900 })
    expect(store.get(ROW.id)?.memory).toEqual(SAVED)
    expect(pastFile(past).sessions[0]).not.toHaveProperty('memory')
  })

  it('setMemory on an unknown id writes neither file', () => {
    const { store, past, memory } = make()
    store.archive(ROW)
    const before = [past.writes(), memory.writes()]
    store.setMemory('nope', SAVED)
    expect([past.writes(), memory.writes()]).toEqual(before)
  })

  it('a Forget prunes its entry', () => {
    const { store, memory } = make()
    store.archive(ROW)
    store.archive({ ...ROW, id: 's2' })
    store.setMemory('s1', SAVED)
    store.setMemory('s2', SAVED)
    store.remove('s1')
    expect(Object.keys(memoryFile(memory).records)).toEqual(['s2'])
  })

  it('a workspace cascade prunes the entries of its records', () => {
    const { store, memory } = make()
    store.archive(ROW)
    store.archive({ ...ROW, id: 's2', workspaceId: 'w2' })
    store.setMemory('s1', SAVED)
    store.setMemory('s2', SAVED)
    store.removeByWorkspace('w2')
    expect(Object.keys(memoryFile(memory).records)).toEqual(['s1'])
  })

  it('the cap prunes the entry of the record it evicts', () => {
    const { store, memory } = make()
    store.archive({ ...ROW, id: 'oldest', endedAt: 1 })
    store.setMemory('oldest', SAVED)
    for (let i = 0; i < PAST_SESSIONS_MAX; i++)
      store.archive({ ...ROW, id: `r${i}`, endedAt: 10 + i })
    expect(store.get('oldest')).toBeNull()
    expect(memoryFile(memory).records).toEqual({})
  })

  it('a /clear rebind that drops the old live record prunes its entry', () => {
    const { store, memory } = make()
    store.markLive(ROW)
    store.setMemory(ROW.id, SAVED)
    store.dropLive(ROW.id)
    expect(memoryFile(memory).records).toEqual({})
  })

  it('an archive with no transcript prunes the entry of the live record it drops', () => {
    let transcript = true
    const { store, memory } = make({ hasTranscript: () => transcript })
    store.markLive(ROW)
    store.setMemory(ROW.id, SAVED)
    transcript = false
    store.archive(ROW)
    expect(memoryFile(memory).records).toEqual({})
  })

  it('an entry whose record is not in the file is pruned at load', () => {
    const memory = fakeBlob<PastSessionsMemoryFile>({ version: 1, records: { gone: SAVED } })
    make({ memory })
    expect(memoryFile(memory).records).toEqual({})
  })

  it('a damaged state file is backed up and reported; the past sessions stay', () => {
    const report = vi.fn()
    const reportMemory = vi.fn()
    const past = fakeBlob<PastSessionsFile>({ version: 1, sessions: [ROW] })
    const memory = fakeBlob<PastSessionsMemoryFile>({ version: 1, records: { s1: { state: 1 } } })
    const log = vi.fn()
    const { store } = make({ past, memory, report, reportMemory, log })
    expect(store.list().map((r) => r.id)).toEqual(['s1'])
    expect(store.get('s1')).not.toHaveProperty('memory')
    expect(memory.backups()).toBe(1)
    expect(reportMemory).toHaveBeenCalledWith('corrupt_reset')
    expect(report).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][past-sessions] code=past_sessions_memory_corrupt_reset_to_defaults'
    )
  })

  it('an unreadable state file reports read_failed', () => {
    const reportMemory = vi.fn()
    const memory = fakeBlob<PastSessionsMemoryFile>()
    memory.blobStore.read = () => {
      throw new Error('EACCES')
    }
    make({ memory, reportMemory, log: () => undefined })
    expect(reportMemory).toHaveBeenCalledWith('read_failed')
  })

  it('a refused state write keeps the state for this run and reports write_failed', () => {
    const reportMemory = vi.fn()
    const memory = fakeBlob<PastSessionsMemoryFile>()
    const { store } = make({ memory, reportMemory, log: () => undefined })
    store.archive(ROW)
    memory.blobStore.write = () => {
      throw new Error('disk full')
    }
    store.setMemory(ROW.id, SAVED)
    expect(store.get(ROW.id)?.memory).toEqual(SAVED)
    expect(reportMemory).toHaveBeenCalledWith('write_failed')
  })

  it('a Forget whose state write is refused is still done', () => {
    const reportMemory = vi.fn()
    const memory = fakeBlob<PastSessionsMemoryFile>()
    const { store } = make({ memory, reportMemory, log: () => undefined })
    store.archive(ROW)
    store.setMemory(ROW.id, SAVED)
    memory.blobStore.write = () => {
      throw new Error('disk full')
    }
    expect(store.remove(ROW.id)).toEqual([])
    expect(reportMemory).toHaveBeenCalledWith('write_failed')
  })
})

describe('past sessions: what each file keeps (R50)', () => {
  it('the Past sessions blob never holds `memory`, after setMemory, an archive that carries it and a load', () => {
    const { store, past, memory } = make()
    store.archive({ ...ROW, memory: SAVED })
    store.setMemory(ROW.id, { ...SAVED, specifics: 5 })
    store.archive({ ...ROW, endedAt: 900, memory: SAVED })
    expect(pastFile(past).sessions.map((r) => Object.keys(r).includes('memory'))).toEqual([false])
    const next = make({ past, memory }).store
    expect(next.get(ROW.id)?.memory).toEqual(SAVED)
    expect(pastFile(past).sessions.map((r) => Object.keys(r).includes('memory'))).toEqual([false])
  })

  it("a hidden record's entry is kept (UX-03: its workspace may come back)", () => {
    let exists = true
    const { store, past, memory } = make({ workspaceExists: () => exists })
    store.archive({ ...ROW, workspaceId: 'w2' })
    store.setMemory(ROW.id, SAVED)
    exists = false
    store.archive({ ...ROW, id: 's2' })
    make({ past, memory, workspaceExists: () => exists })
    expect(memoryFile(memory).records).toEqual({ s1: SAVED })
  })

  it('a Forget the disk refuses keeps the entry', () => {
    const { store, past, memory } = make()
    store.archive(ROW)
    store.setMemory(ROW.id, SAVED)
    past.blobStore.write = () => {
      throw new Error('disk full')
    }
    expect(() => store.remove(ROW.id)).toThrow('store_write_failed')
    expect(memoryFile(memory).records).toEqual({ s1: SAVED })
    expect(store.get(ROW.id)?.memory).toEqual(SAVED)
  })
})

describe('past sessions: a file an earlier build of this branch wrote (R50 migration)', () => {
  const OLD = {
    version: 1,
    sessions: [
      { ...ROW, memory: SAVED },
      { ...ROW, id: 's2' }
    ]
  }

  it('a record holding `memory` does not reset the store', () => {
    const past = fakeBlob<PastSessionsFile>(OLD)
    const log = vi.fn()
    const { store } = make({ past, log })
    expect(past.backups()).toBe(0)
    expect(store.list().map((r) => r.id)).toEqual(['s1', 's2'])
    expect(log).not.toHaveBeenCalled()
  })

  it('a refused state write leaves the inline field in the Past sessions file and reports it', () => {
    const past = fakeBlob<PastSessionsFile>(OLD)
    const memory = fakeBlob<PastSessionsMemoryFile>()
    memory.blobStore.write = () => {
      throw new Error('disk full')
    }
    const reportMemory = vi.fn()
    const { store } = make({ past, memory, reportMemory, log: () => undefined })
    expect(reportMemory).toHaveBeenCalledWith('write_failed')
    expect(pastFile(past).sessions.find((r) => r.id === 's1')?.memory).toEqual(SAVED)
    expect(store.get('s1')?.memory).toEqual(SAVED)
  })

  it('a later load completes a migration whose state write was refused, and a third changes nothing', () => {
    const past = fakeBlob<PastSessionsFile>(OLD)
    const refused = fakeBlob<PastSessionsMemoryFile>()
    refused.blobStore.write = () => {
      throw new Error('disk full')
    }
    make({ past, memory: refused, log: () => undefined })
    const memory = fakeBlob<PastSessionsMemoryFile>()
    make({ past, memory })
    expect(memoryFile(memory)).toEqual({ version: 1, records: { s1: SAVED } })
    expect(pastFile(past).sessions.map((r) => Object.keys(r).includes('memory'))).toEqual([
      false,
      false
    ])
    const before = [JSON.stringify(past.current()), JSON.stringify(memory.current())]
    make({ past, memory })
    expect([JSON.stringify(past.current()), JSON.stringify(memory.current())]).toEqual(before)
  })

  it('a state write that succeeds later in the run strips the Past sessions file then', () => {
    const past = fakeBlob<PastSessionsFile>(OLD)
    const memory = fakeBlob<PastSessionsMemoryFile>()
    const write = memory.blobStore.write
    memory.blobStore.write = () => {
      throw new Error('disk full')
    }
    const { store } = make({ past, memory, log: () => undefined })
    memory.blobStore.write = write
    store.setMemory('s2', SAVED)
    expect(memoryFile(memory).records).toEqual({ s1: SAVED, s2: SAVED })
    expect(pastFile(past).sessions.map((r) => Object.keys(r).includes('memory'))).toEqual([
      false,
      false
    ])
  })

  it('moves the field into the state file and writes the record back without it', () => {
    const past = fakeBlob<PastSessionsFile>(OLD)
    const { store, memory } = make({ past })
    expect(store.get('s1')?.memory).toEqual(SAVED)
    expect(memoryFile(memory)).toEqual({ version: 1, records: { s1: SAVED } })
    expect(pastFile(past).sessions.map((r) => Object.keys(r).includes('memory'))).toEqual([
      false,
      false
    ])
  })
})

// A FROZEN copy of the phase-1 build's Past sessions schema (`src/shared/schemas/pastSession.ts`
// at 120e59d, the last commit before memory phase 2): what an older build that opens this profile
// again parses the file with. `SessionNameSchema` and `WorkspaceIdSchema` are unchanged since.
// Never update it to follow the current schema: its point is that it does not.
const Phase1PastSessionSchema = z
  .object({
    id: z.string().min(1),
    name: SessionNameSchema,
    cwd: z.string().min(1),
    workspaceId: WorkspaceIdSchema,
    tagIds: z.array(z.string().min(1)).default([]),
    launchedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    live: z.literal(true).optional(),
    transcriptPath: z.string().min(1).optional(),
    tasksMarkDone: z.literal(true).optional()
  })
  .strict()
const Phase1PastSessionsFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(Phase1PastSessionSchema)
})

describe('past sessions: going back to the phase-1 build (R50)', () => {
  it('the phase-1 schema parses a file the new code wrote with every record field set', () => {
    const { store, past } = make()
    store.markLive({ ...ROW, id: 'live', transcriptPath: '/t/live.jsonl', tasksMarkDone: true })
    store.archive({ ...ROW, transcriptPath: '/t/s1.jsonl', tasksMarkDone: true })
    store.setMemory('s1', SAVED)
    store.setMemory('live', { ...SAVED, state: 'saving' })
    const parsed = Phase1PastSessionsFileSchema.safeParse(past.current())
    expect(parsed.success).toBe(true)
    expect(parsed.data?.sessions.map((r) => r.id).sort()).toEqual(['live', 's1'])
  })
})
