// The wiring of the extractor into main (Task 11, Part 11a): the real call (claude resolved like a
// launch, the composed command, the cleaned env, the `memory-extract` folder), the quit kill (R17),
// the version gate that keeps only an OK answer (R35), and the workspace cascade's memory step
// (forget the jobs first, then the rows). Tests never run the real claude: the fakes stand in for
// it, and the one real process is a stub shell script in a temp folder.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  META,
  createHarness,
  flush,
  prompt,
  said,
  type Harness
} from '../../../__fixtures__/extractorHarness'
import { EXTRACT_JSON_SCHEMA, EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import { createExtractor } from './extractor'
import { EXTRACT_SYSTEM_PROMPT } from './extractPrompt'
import {
  createTimerPair,
  extractSources,
  createExtractCall,
  createExtractVersionGate,
  memoryCascadeStep
} from './extractWiring'
import { composeExtractCommand, type ChildSeam, type SpawnSeam } from './headlessClaude'
import type { TranscriptLookupDeps } from '../../pty/claudeTranscript'
import type { OpenedMemory } from '../memoryStartup'

const PID = 4242
const CLAUDE = '/opt/my tools/claude'

type Spawned = { file: string; args: readonly string[]; options: Parameters<SpawnSeam>[2] }

/** A child that never closes (it ignores SIGTERM), records what it was given on stdin. */
function fakeSpawn(): { spawn: SpawnSeam; spawned: Spawned[]; stdin: string[] } {
  const spawned: Spawned[] = []
  const stdin: string[] = []
  const child: ChildSeam = {
    pid: PID,
    stdin: { end: (text) => void stdin.push(text), on: () => undefined, destroy: () => undefined },
    stdout: { on: () => undefined, destroy: () => undefined },
    on: () => undefined
  }
  return {
    spawned,
    stdin,
    spawn: (file, args, options) => {
      spawned.push({ file, args, options })
      return child
    }
  }
}

/** A hand-driven timer pair: nothing fires unless the test runs it. */
function handTimers(): {
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  pending: Map<number, { fn: () => void; ms: number }>
  /** Runs (and drops) every pending timer of `ms`. */
  fire: (ms: number) => void
} {
  const pending = new Map<number, { fn: () => void; ms: number }>()
  let next = 0
  return {
    pending,
    setTimer: (fn, ms) => {
      next += 1
      pending.set(next, { fn, ms })
      return next
    },
    clearTimer: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
    fire: (ms) => {
      for (const [id, t] of [...pending]) {
        if (t.ms !== ms) continue
        pending.delete(id)
        t.fn()
      }
    }
  }
}

/** A child the test drives: it feeds stdout and closes it by hand. */
function drivenChild(): {
  child: ChildSeam
  data: (chunk: Buffer) => void
  close: (code: number | null) => void
} {
  let onData: (chunk: Buffer) => void = () => undefined
  let onClose: (code: number | null) => void = () => undefined
  const child: ChildSeam = {
    pid: PID,
    stdin: { end: () => undefined, on: () => undefined, destroy: () => undefined },
    stdout: {
      on: (event: 'data' | 'error', cb: ((chunk: Buffer) => void) | (() => void)) => {
        if (event === 'data') onData = cb
      },
      destroy: () => undefined
    },
    on: (event: 'close' | 'error', cb: ((code: number | null) => void) | (() => void)) => {
      if (event === 'close') onClose = cb
    }
  }
  return { child, data: (chunk) => onData(chunk), close: (code) => onClose(code) }
}

/** The real call over the real `spawn` and `process.kill` and real timers, with `stub` in claude's
 *  place; records the child pids, the signals sent and the timers still pending. */
function realCall(
  dir: string,
  stub: string
): {
  call: ReturnType<typeof createExtractCall>
  pids: (number | undefined)[]
  kills: [number, string][]
  timers: Set<ReturnType<typeof setTimeout>>
} {
  const pids: (number | undefined)[] = []
  const kills: [number, string][] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const call = createExtractCall({
    shell: '/bin/sh',
    userData: () => dir,
    env: () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin' }),
    resolveClaude: () => ({ command: stub, dir: null }),
    spawn: (file, args, options) => {
      const child = spawn(file, args, options)
      pids.push(child.pid)
      return child
    },
    kill: (groupId, signal) => {
      kills.push([groupId, signal])
      process.kill(groupId, signal)
    },
    // As main passes it: Node's own, with the options createExtractCall gives (R36).
    mkdir: mkdirSync,
    setTimer: (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
      return t
    },
    clearTimer: (handle) => {
      for (const t of timers) {
        if (t !== handle) continue
        clearTimeout(t)
        timers.delete(t)
      }
    }
  })
  return { call, pids, kills, timers }
}

type WiringDeps = Parameters<typeof createExtractCall>[0]

function wiring(
  over: Partial<Pick<WiringDeps, 'spawn' | 'mkdir' | 'userData' | 'env' | 'resolveClaude'>> = {}
): {
  call: ReturnType<typeof createExtractCall>
  fake: ReturnType<typeof fakeSpawn>
  kills: [number, string][]
  mkdirs: [string, unknown][]
  timers: ReturnType<typeof handTimers>
} {
  const fake = fakeSpawn()
  const kills: [number, string][] = []
  const mkdirs: [string, unknown][] = []
  const timers = handTimers()
  const call = createExtractCall({
    shell: '/bin/sh',
    userData: over.userData ?? (() => '/data/app'),
    env:
      over.env ??
      (() => ({
        PATH: '/usr/bin',
        HOME: '/home/op',
        CLAUDECODE: '1',
        CLAUDE_WATCHER_MEMORY: '1',
        CLAUDE_WATCHER_MOD_URL: 'http://127.0.0.1:1/mod/report'
      })),
    resolveClaude: over.resolveClaude ?? (() => ({ command: CLAUDE, dir: '/opt/my tools' })),
    spawn: over.spawn ?? fake.spawn,
    kill: (groupId, signal) => void kills.push([groupId, signal]),
    mkdir: over.mkdir ?? ((dir, options) => void mkdirs.push([dir, options])),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })
  return { call, fake, kills, mkdirs, timers }
}

describe('the real call', () => {
  it('runs the composed command in the memory-extract folder with the cleaned env', () => {
    const w = wiring()
    w.call('haiku', 'SLICE-7f3a')
    expect(w.fake.spawned).toHaveLength(1)
    const s = w.fake.spawned[0]
    expect(s?.file).toBe('/bin/sh')
    expect(s?.args).toEqual([
      '-l',
      '-c',
      composeExtractCommand({
        claudeCommand: CLAUDE,
        model: 'haiku',
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        jsonSchema: EXTRACT_JSON_SCHEMA,
        budgetUsd: EXTRACT_LIMITS.budgetUsd
      })
    ])
    expect(s?.args[2]?.startsWith(`'${CLAUDE}' -p `)).toBe(true)
    expect(s?.options.cwd).toBe('/data/app/memory-extract')
    expect(s?.options.detached).toBe(true)
    expect(s?.options.env).not.toHaveProperty('CLAUDE_WATCHER_MEMORY')
    expect(s?.options.env).not.toHaveProperty('CLAUDE_WATCHER_MOD_URL')
    expect(s?.options.env).not.toHaveProperty('CLAUDECODE')
    expect(s?.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    expect(s?.options.env.PATH).toBe('/opt/my tools:/usr/bin')
    expect(s?.options.env.HOME).toBe('/home/op')
    expect(w.mkdirs.map(([dir]) => dir)).toEqual(['/data/app/memory-extract'])
    // The slice goes on stdin, never on argv.
    expect(w.fake.stdin).toEqual(['SLICE-7f3a'])
    expect(s?.args.join(' ')).not.toContain('SLICE-7f3a')
  })

  it("uses EXTRACT_LIMITS' timeout and grace: SIGTERM at the timeout, SIGKILL one grace later", () => {
    const w = wiring()
    w.call('sonnet', 'x')
    expect([...w.timers.pending.values()].map((t) => t.ms)).toEqual([EXTRACT_LIMITS.timeoutMs])
    w.timers.fire(EXTRACT_LIMITS.timeoutMs)
    expect(w.kills).toEqual([[-PID, 'SIGTERM']])
    expect([...w.timers.pending.values()].map((t) => t.ms)).toEqual([EXTRACT_LIMITS.killGraceMs])
  })

  it('caps stdout at EXTRACT_LIMITS.stdoutBytes: one byte more kills the call', async () => {
    const c = drivenChild()
    const w = wiring({ spawn: () => c.child })
    const call = w.call('sonnet', 'x')
    c.data(Buffer.alloc(EXTRACT_LIMITS.stdoutBytes))
    expect(w.kills).toEqual([])
    c.data(Buffer.alloc(1))
    expect(w.kills).toEqual([[-PID, 'SIGTERM']])
    c.close(null)
    expect(await call.result).toEqual({ ok: false, reason: 'exit', issue: null })
  })

  it("makes the folder with mode 0700, recursive (R36: the mode is not the caller's)", () => {
    const w = wiring()
    w.call('sonnet', 'x')
    expect(w.mkdirs).toEqual([['/data/app/memory-extract', { recursive: true, mode: 0o700 }]])
  })

  const boom = (): never => {
    throw new Error('EACCES')
  }
  it.each([
    ['the folder it cannot make', { mkdir: boom }],
    ['userData', { userData: boom }],
    ['resolving claude', { resolveClaude: boom }],
    ['the base env', { env: boom }]
  ] satisfies [string, Partial<WiringDeps>][])(
    'a throw from %s is a spawn failure: nothing spawns, nothing is signalled, nothing throws',
    async (_seam, over) => {
      const spawnSpy = vi.fn<SpawnSeam>()
      const w = wiring({ ...over, spawn: spawnSpy })
      const call = w.call('sonnet', 'x')
      expect(await call.result).toEqual({ ok: false, reason: 'spawn', issue: null })
      call.cancel()
      call.killNow()
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(w.kills).toEqual([])
      expect(w.timers.pending.size).toBe(0)
    }
  )
})

function conversation(h: Harness, id: string): void {
  h.write(
    id,
    prompt('the api now listens on port 9281 locally'),
    said('moved the api'),
    prompt('thanks, that works'),
    said('glad')
  )
}

describe('quit (R17)', () => {
  it('quit sends SIGKILL to the group of a call whose child ignores SIGTERM, before quit returns', async () => {
    const h = createHarness()
    h.meta.set('s1', META)
    const w = wiring()
    const ex = createExtractor({ ...h.deps, call: w.call })
    conversation(h, 's1')
    ex.stop('s1')
    ex.ended('s1')
    await flush()
    expect(w.fake.spawned).toHaveLength(1)
    expect(w.kills).toEqual([])
    ex.quit()
    expect(w.kills).toEqual([[-PID, 'SIGKILL']])
  })

  describe('with a real child that ignores SIGTERM', () => {
    let dir = ''
    /** The stub's pids, killed after each run: a failed run must not leave it running. */
    let spawned: (number | undefined)[] = []
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'cw-extract-quit-'))
      spawned = []
    })
    afterEach(() => {
      for (const pid of spawned) {
        // Only a real child's pid (2 or more): never 0, never a negative number, so this can only
        // reach the stub's own group, never the runner's.
        if (pid === undefined || !Number.isInteger(pid) || pid < 2) continue
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // ESRCH: the group is already gone, which is the passing case.
        }
      }
      rmSync(dir, { recursive: true, force: true })
    })

    it('the process group is gone once quit has run, with no timer left to fire', async () => {
      const mark = join(dir, 'started')
      const stub = join(dir, 'claude stub.sh')
      // Ignores SIGTERM (an ignored signal stays ignored across exec), says it started, then waits.
      writeFileSync(stub, `#!/bin/sh\ntrap '' TERM\n: > '${mark}'\nexec sleep 30\n`)
      chmodSync(stub, 0o755)
      const { call, pids, kills, timers } = realCall(dir, stub)
      spawned = pids
      const h = createHarness()
      h.meta.set('s1', META)
      const ex = createExtractor({ ...h.deps, call })
      conversation(h, 's1')
      ex.stop('s1')
      ex.ended('s1')
      await vi.waitFor(() => expect(existsSync(mark)).toBe(true), { timeout: 10_000 })
      expect(pids).toHaveLength(1)
      const pid = Number(pids[0])
      expect(pid).toBeGreaterThan(0)
      ex.quit()
      expect(kills).toEqual([[-pid, 'SIGKILL']])
      await ex.idle()
      await vi.waitFor(() => expect(() => process.kill(-pid, 0)).toThrow(/ESRCH/), {
        timeout: 5_000
      })
      expect(timers.size).toBe(0)
      expect(h.state.get('s1')?.phase).toBe('ending')
    }, 20_000)
  })
})

describe('createExtractVersionGate (R35)', () => {
  it('the version gate lets an unreadable version and 2.1.323 through and stops 2.1.322', () => {
    expect(createExtractVersionGate(() => null)()).toBe(true)
    expect(createExtractVersionGate(() => 'not a version')()).toBe(true)
    expect(createExtractVersionGate(() => '2.1.323 (Claude Code)')()).toBe(true)
    expect(createExtractVersionGate(() => '2.2.0 (Claude Code)')()).toBe(true)
    expect(createExtractVersionGate(() => '2.1.322 (Claude Code)')()).toBe(false)
  })

  it('an OK version answer is read once for many jobs', () => {
    const readRaw = vi.fn(() => '2.1.323')
    const gate = createExtractVersionGate(readRaw)
    expect([gate(), gate(), gate(), gate(), gate()]).toEqual([true, true, true, true, true])
    expect(readRaw).toHaveBeenCalledTimes(1)
  })

  it('an unreadable answer is an OK answer, kept for the run', () => {
    const readRaw = vi.fn<() => string | null>(() => null)
    const gate = createExtractVersionGate(readRaw)
    expect([gate(), gate(), gate()]).toEqual([true, true, true])
    expect(readRaw).toHaveBeenCalledTimes(1)
  })

  it('a not-OK version answer is not kept by the gate', () => {
    const readRaw = vi.fn<() => string | null>()
    readRaw.mockReturnValueOnce('2.1.322').mockReturnValueOnce('2.1.323')
    const gate = createExtractVersionGate(readRaw)
    expect(gate()).toBe(false)
    expect(readRaw).toHaveBeenCalledTimes(1)
    expect(gate()).toBe(true)
    expect(readRaw).toHaveBeenCalledTimes(2)
    expect(gate()).toBe(true)
    expect(readRaw).toHaveBeenCalledTimes(2)
  })
})

describe("the version gate reuses the launch path's answer (R37)", () => {
  it('after a launch read an OK version, many saves run no --version of their own', () => {
    const readRaw = vi.fn(() => '2.1.330')
    const gate = createExtractVersionGate(readRaw, () => '2.1.330')
    expect([gate(), gate(), gate(), gate(), gate()]).toEqual([true, true, true, true, true])
    expect(readRaw).not.toHaveBeenCalled()
  })

  it('an unreadable launch answer is OK too (fail open), with no read of its own', () => {
    const readRaw = vi.fn(() => '2.1.330')
    expect(createExtractVersionGate(readRaw, () => null)()).toBe(true)
    expect(readRaw).not.toHaveBeenCalled()
  })

  it('a too-old launch answer is not trusted: the gate reads again, so an upgrade can save', () => {
    const readRaw = vi.fn(() => '2.1.330')
    expect(createExtractVersionGate(readRaw, () => '2.1.322')()).toBe(true)
    expect(readRaw).toHaveBeenCalledTimes(1)
  })

  it('before any launch read, a catch-up reads the version itself', () => {
    const readRaw = vi.fn(() => '2.1.322')
    expect(createExtractVersionGate(readRaw, () => undefined)()).toBe(false)
    expect(readRaw).toHaveBeenCalledTimes(1)
  })
})

describe('the workspace cascade step', () => {
  it('a workspace delete cancels its running save before its rows are removed', async () => {
    const h = createHarness()
    h.meta.set('s1', META)
    h.set.manual = true
    conversation(h, 's1')
    h.ex.stop('s1')
    h.ex.ended('s1')
    await flush()
    expect(h.calls).toHaveLength(1)
    const order: string[] = []
    const step = memoryCascadeStep(
      () => ({
        forgetWorkspace: (id) => {
          order.push('forget')
          h.ex.forgetWorkspace(id)
        }
      }),
      () => ({
        removeByWorkspace: (id) => {
          order.push('rows')
          h.state.removeByWorkspace(id)
        }
      })
    )
    step.removeByWorkspace('w1')
    expect(order).toEqual(['forget', 'rows'])
    expect(h.calls[0]?.cancel).toHaveBeenCalledTimes(1)
    expect(h.state.get('s1')).toBeNull()
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
  })

  it('either side null is skipped; the other still runs', () => {
    const forgetWorkspace = vi.fn()
    const removeByWorkspace = vi.fn()
    memoryCascadeStep(
      () => null,
      () => ({ removeByWorkspace })
    ).removeByWorkspace('w1')
    expect(removeByWorkspace).toHaveBeenCalledWith('w1')
    memoryCascadeStep(
      () => ({ forgetWorkspace }),
      () => null
    ).removeByWorkspace('w2')
    expect(forgetWorkspace).toHaveBeenCalledWith('w2')
  })

  it('never throws: a throwing side is logged as a code and the other still runs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const removeByWorkspace = vi.fn()
    const forgetWorkspace = vi.fn()
    expect(() =>
      memoryCascadeStep(
        () => ({
          forgetWorkspace: () => {
            throw new Error('boom')
          }
        }),
        () => ({ removeByWorkspace })
      ).removeByWorkspace('w1')
    ).not.toThrow()
    expect(removeByWorkspace).toHaveBeenCalledWith('w1')
    expect(() =>
      memoryCascadeStep(
        () => ({ forgetWorkspace }),
        () => ({
          removeByWorkspace: () => {
            throw new Error('boom')
          }
        })
      ).removeByWorkspace('w2')
    ).not.toThrow()
    expect(forgetWorkspace).toHaveBeenCalledWith('w2')
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      '[claude-watcher][memory] code=memory_cascade_failed step=forget',
      '[claude-watcher][memory] code=memory_cascade_failed step=rows'
    ])
    warn.mockRestore()
  })
})

describe('the real timer pair', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a cleared timer never fires, and a handle it did not make is ignored', () => {
    vi.useFakeTimers()
    const { setTimer, clearTimer } = createTimerPair()
    const fired: string[] = []
    const kept = setTimer(() => fired.push('kept'), 10)
    const cleared = setTimer(() => fired.push('cleared'), 10)
    clearTimer(cleared)
    const foreign = setTimeout(() => fired.push('foreign'), 10)
    clearTimer(foreign)
    clearTimer(42)
    vi.advanceTimersByTime(10)
    expect(fired).toEqual(['kept', 'foreign'])
    clearTimer(kept)
  })
})

describe("the extractor's view of main", () => {
  const ID = '4f9a3c1e-2b7d-4e8a-9c6f-1a2b3c4d5e6f'
  /** claude's projects folder holding `folders`, where only the paths in `files` exist. */
  const lookup = (folders: string[], files: string[]) => (): TranscriptLookupDeps => ({
    projectsDir: '/claude/projects',
    listDir: () => folders,
    fileState: (path) => (files.includes(path) ? 'file' : 'missing')
  })

  it('memory is null until it is open, then names the store, the commands and the save state', () => {
    const h = createHarness()
    let opened: Pick<OpenedMemory, 'store' | 'commands' | 'extractState'> | null = null
    const sources = extractSources({ memory: () => opened, lookup: lookup([], []) })
    expect(sources.memory()).toBeNull()
    opened = { store: h.store, commands: h.commands, extractState: h.state }
    expect(sources.memory()).toEqual({ store: h.store, commands: h.commands, state: h.state })
  })

  it('locates a transcript claude has, and nothing for one it does not', () => {
    const path = `/claude/projects/-work-acme/${ID}.jsonl`
    const sources = extractSources({ memory: () => null, lookup: lookup(['-work-acme'], [path]) })
    expect(sources.locate(ID)).toBe(path)
    expect(sources.locate('6e5d4c3b-2a1f-4e9c-8a7d-b2e1f0a9c8d7')).toBeNull()
    expect(sources.locate('not-a-uuid')).toBeNull()
  })
})
