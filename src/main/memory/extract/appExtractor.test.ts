// The app's one extractor as main builds it (Task 11): the kill gets the process-group id unchanged,
// the folder is made 0700, the version check reuses the launch path's answer (R37), and the start's
// catch-up runs once, only after the stores exist. Real `:memory:` store and save state; a fake
// spawn whose child never closes; no real claude.
import { describe, expect, it, vi } from 'vitest'
import {
  META,
  createHarness,
  flush,
  prompt,
  said,
  type Harness
} from '../../../__fixtures__/extractorHarness'
import type { TranscriptLookupDeps } from '../../pty/claudeTranscript'
import { createAppExtractor, type AppExtractorIo } from './appExtractor'
import type { ChildSeam, SpawnSeam } from './headlessClaude'

const ID = '4f9a3c1e-2b7d-4e8a-9c6f-1a2b3c4d5e6f'
const PID = 4242
const IDS = [ID, '6e5d4c3b-2a1f-4e9c-8a7d-b2e1f0a9c8d7', '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d']

/** claude's projects folder, holding a transcript for each of IDS. */
const lookup = (): TranscriptLookupDeps => ({
  projectsDir: '/claude/projects',
  listDir: () => ['p'],
  fileState: (path) =>
    IDS.some((id) => path === `/claude/projects/p/${id}.jsonl`) ? 'file' : 'missing'
})

/** Every outside effect the app extractor makes, recorded. */
function app(
  h: Harness,
  over: Partial<AppExtractorIo> = {}
): {
  io: AppExtractorIo
  spawned: Parameters<SpawnSeam>[]
  kills: [number, string][]
  mkdirs: [string, unknown][]
  versionReads: ReturnType<typeof vi.fn<() => string | null>>
  logs: string[]
} {
  const spawned: Parameters<SpawnSeam>[] = []
  const kills: [number, string][] = []
  const mkdirs: [string, unknown][] = []
  const logs: string[] = []
  const versionReads = vi.fn<() => string | null>(() => '2.1.330')
  const child: ChildSeam = {
    pid: PID,
    stdin: { end: () => undefined, on: () => undefined, destroy: () => undefined },
    stdout: { on: () => undefined, destroy: () => undefined },
    on: () => undefined
  }
  const io: AppExtractorIo = {
    settings: () => ({
      memoryEnabled: true,
      memoryCheckpoint: 15,
      memorySaveTasks: true,
      memoryModel: 'sonnet'
    }),
    memory: () => ({ store: h.store, commands: h.commands, extractState: h.state }),
    goals: () => h.goals,
    pastSessions: () => ({ setMemory: h.setMemory }),
    sessionMeta: (id) => h.meta.get(id) ?? null,
    activity: h.activity,
    push: () => undefined,
    lookup,
    readSlice: h.deps.read,
    version: { read: versionReads, held: () => undefined },
    shell: '/bin/sh',
    userData: () => '/data/app',
    ptyEnv: () => ({ PATH: '/usr/bin', CLAUDECODE: '1', CLAUDE_WATCHER_MEMORY: '1' }),
    resolveClaude: () => ({ command: '/opt/claude', dir: null }),
    spawn: (...args) => {
      spawned.push(args)
      return child
    },
    kill: (groupId, signal) => void kills.push([groupId, signal]),
    mkdir: (dir, options) => void mkdirs.push([dir, options]),
    now: () => h.clock.now,
    log: (line) => void logs.push(line),
    ...over
  }
  return { io, spawned, kills, mkdirs, versionReads, logs }
}

function conversation(h: Harness, id = ID): void {
  h.meta.set(id, META)
  h.write(id, prompt('the api now listens on port 9281'), said('moved it'), prompt('thanks'))
}

/** A child that exits with code 1 as soon as it is listened to. */
const exitingChild = (): ChildSeam => ({
  pid: PID,
  stdin: { end: () => undefined, on: () => undefined, destroy: () => undefined },
  stdout: { on: () => undefined, destroy: () => undefined },
  on: (event: 'close' | 'error', cb: ((code: number | null) => void) | (() => void)) => {
    if (event === 'close') setImmediate(() => cb(1))
  }
})

describe('the app extractor', () => {
  it("a quit hands the save call's process-group id to kill unchanged", async () => {
    const h = createHarness()
    const a = app(h)
    const { extractor } = createAppExtractor(a.io)
    conversation(h)
    extractor.ended(ID)
    await flush()
    expect(a.spawned).toHaveLength(1)
    extractor.quit()
    expect(a.kills).toEqual([[-PID, 'SIGKILL']])
  })

  it('a save call runs in a 0700 folder under userData, with the cleaned session env', async () => {
    const h = createHarness()
    const a = app(h)
    const { extractor } = createAppExtractor(a.io)
    conversation(h)
    extractor.ended(ID)
    await flush()
    expect(a.mkdirs).toEqual([['/data/app/memory-extract', { recursive: true, mode: 0o700 }]])
    const options = a.spawned[0]?.[2]
    expect(options?.cwd).toBe('/data/app/memory-extract')
    expect(options?.env).not.toHaveProperty('CLAUDECODE')
    expect(options?.env).not.toHaveProperty('CLAUDE_WATCHER_MEMORY')
    extractor.quit()
  })

  it('after a launch read an OK version, many saves run no --version of their own (R37)', async () => {
    const h = createHarness()
    const a = app(h)
    const spawned: string[] = []
    const { extractor } = createAppExtractor({
      ...a.io,
      version: { read: a.versionReads, held: () => '2.1.330' },
      spawn: () => {
        spawned.push('call')
        return exitingChild()
      }
    })
    for (const id of IDS) {
      conversation(h, id)
      extractor.ended(id)
    }
    await extractor.idle()
    expect(spawned.length).toBeGreaterThanOrEqual(IDS.length)
    expect(a.versionReads).not.toHaveBeenCalled()
  })

  it('a catch-up before any launch reads the version itself, once', async () => {
    const h = createHarness()
    const a = app(h)
    const { extractor } = createAppExtractor(a.io)
    conversation(h)
    extractor.ended(ID)
    await flush()
    expect(a.versionReads).toHaveBeenCalledTimes(1)
    extractor.quit()
  })
})

describe('the start', () => {
  it('catches up once, and only after the goals and past-sessions stores exist', async () => {
    const h = createHarness()
    let ready = false
    const a = app(h, {
      goals: () => (ready ? h.goals : null),
      pastSessions: () => (ready ? { setMemory: h.setMemory } : null)
    })
    const app1 = createAppExtractor(a.io)
    conversation(h)
    h.state.track({
      sessionId: ID,
      originSessionId: ID,
      workspaceId: 'w1',
      meta: {
        folder: META.folder,
        sessionName: META.sessionName,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      },
      phase: 'ending',
      at: h.clock.now
    })
    app1.start()
    await flush()
    expect(a.spawned).toHaveLength(0)
    expect(a.logs).toEqual(['[claude-watcher][memory] code=memory_catchup_not_ready'])
    ready = true
    app1.start()
    await flush()
    expect(a.spawned).toHaveLength(1)
    app1.extractor.quit()
  })

  it('a second start catches up nothing more', async () => {
    const h = createHarness()
    const calls: string[] = []
    const a = app(h, {
      spawn: () => {
        calls.push('call')
        return exitingChild()
      }
    })
    const app1 = createAppExtractor(a.io)
    conversation(h)
    // An end the last run owed: its call fails, so the row stays owed (`ending`).
    h.state.track({
      sessionId: ID,
      originSessionId: ID,
      workspaceId: 'w1',
      meta: {
        folder: META.folder,
        sessionName: META.sessionName,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      },
      phase: 'ending',
      at: h.clock.now
    })
    app1.start()
    await app1.extractor.idle()
    const first = calls.length
    expect(first).toBeGreaterThan(0)
    expect(h.state.get(ID)?.phase).toBe('ending')
    app1.start()
    await app1.extractor.idle()
    expect(calls).toHaveLength(first)
  })
})
