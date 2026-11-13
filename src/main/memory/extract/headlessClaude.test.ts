// The headless model call (addendum "The call", D7–D12): a fake spawn seam and a hand-driven
// timer stand in for `child_process` and the clock, so no real claude ever runs here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTRACT_LIMITS, type ExtractOutput } from '../../../shared/schemas/memoryExtract'
import {
  buildExtractEnv,
  composeExtractCommand,
  parseClaudeResult,
  runExtractCall,
  type ChildSeam,
  type SpawnSeam
} from './headlessClaude'

const output: ExtractOutput = {
  candidates: [
    {
      type: 'specific',
      action: 'add',
      id: null,
      head: 'staging port',
      body: '8443',
      check: null,
      leftWith: null,
      evidence: 'the staging port is 8443'
    }
  ],
  note: 'set up the staging port'
}
const envelope = (structured: unknown): string =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    structured_output: structured
  })
const errorEnvelope = JSON.stringify({ type: 'result', is_error: true, structured_output: output })
const bare = JSON.stringify({ type: 'result', is_error: false, result: 'text' })
const candidate = output.candidates[0]
const thirteen = envelope({ candidates: Array.from({ length: 13 }, () => candidate), note: '' })

describe('composeExtractCommand', () => {
  it('composes the probed flags in order', () => {
    expect(
      composeExtractCommand({
        claudeCommand: '/opt/bin/claude',
        model: 'haiku',
        systemPrompt: 'P',
        jsonSchema: '{}',
        budgetUsd: 1
      })
    ).toBe(
      "'/opt/bin/claude' -p --model 'haiku' --output-format json --json-schema '{}' --system-prompt 'P' --no-session-persistence --setting-sources '' --tools '' --strict-mcp-config --disable-slash-commands --max-budget-usd 1"
    )
  })
})

describe('buildExtractEnv', () => {
  it('the env has no watcher variable, turns claude auto memory off and puts claude first in PATH', () => {
    const base = {
      HOME: '/home/op',
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      CLAUDE_WATCHER_MEMORY: '1',
      CLAUDE_WATCHER_MOD_URL: 'http://127.0.0.1:1/mod',
      CLAUDE_WATCHER_PROFILE: 'drive',
      CLAUDE_WATCHER_CLAUDE_BIN: '/opt/claude'
    }
    expect(buildExtractEnv(base, '/opt/claude-dir')).toEqual({
      HOME: '/home/op',
      PATH: '/opt/claude-dir:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
    })
  })

  it('leaves PATH as it was when the claude folder is unknown, and adds none when there was none', () => {
    expect(buildExtractEnv({ PATH: '/usr/bin' }, null)).toEqual({
      PATH: '/usr/bin',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
    })
    expect(buildExtractEnv({ HOME: '/h' }, null)).toEqual({
      HOME: '/h',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
    })
  })

  it('auto memory is off even when the base says otherwise, and the base is not changed', () => {
    const base = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', CLAUDE_WATCHER_MEMORY: '1' }
    expect(buildExtractEnv(base, null)).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' })
    expect(base).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', CLAUDE_WATCHER_MEMORY: '1' })
  })
})

describe('parseClaudeResult', () => {
  it('a good envelope is the parsed output', () => {
    expect(parseClaudeResult(envelope(output) + '\n')).toEqual({ ok: true, output })
  })

  it('takes the last JSON line when the login shell printed something first', () => {
    expect(parseClaudeResult('welcome to bash\n' + envelope(output))).toEqual({ ok: true, output })
  })

  it('takes the LAST line that starts with {, not the first', () => {
    expect(parseClaudeResult('{"motd":1}\n' + envelope(output) + '\ntrailing text')).toEqual({
      ok: true,
      output
    })
  })

  it.each([
    ['is_error true', errorEnvelope, 'envelope'],
    ['no structured_output', bare, 'envelope'],
    ['stdout that is not JSON', 'oops', 'envelope'],
    ['empty stdout', '', 'envelope'],
    ['a { line that is not JSON', '{oops', 'envelope'],
    ['an envelope with no is_error', JSON.stringify({ structured_output: output }), 'envelope'],
    ['a 13th candidate', thirteen, 'output']
  ])('%s is a failed call', (_n, stdout, reason) => {
    expect(parseClaudeResult(stdout)).toMatchObject({ ok: false, reason })
  })

  it('an envelope failure carries no issue', () => {
    expect(parseClaudeResult(errorEnvelope)).toEqual({ ok: false, reason: 'envelope', issue: null })
  })

  it('an output failure carries the Zod path and code, never a value', () => {
    const result = parseClaudeResult(thirteen)
    expect(result).toEqual({
      ok: false,
      reason: 'output',
      issue: { path: 'candidates', code: 'too_big' }
    })
    expect(JSON.stringify(result)).not.toContain('8443')
  })

  it('a nested output failure names the whole path', () => {
    const bad = envelope({ candidates: [{ ...candidate, type: 'secret' }], note: '' })
    expect(parseClaudeResult(bad)).toEqual({
      ok: false,
      reason: 'output',
      issue: { path: 'candidates.0.type', code: 'invalid_value' }
    })
  })
})

// ---- runExtractCall ----

interface FakeChild extends ChildSeam {
  written: string[]
  data(chunk: Buffer | string): void
  close(code: number | null): void
  fail(): void
  stdinFail(): void
}

function fakeChild(pid: number | undefined): FakeChild {
  const on: { close: ((c: number | null) => void)[]; error: (() => void)[] } = {
    close: [],
    error: []
  }
  const dataCbs: ((chunk: Buffer) => void)[] = []
  const stdinErr: (() => void)[] = []
  const written: string[] = []
  return {
    pid,
    written,
    stdin: {
      end: (text) => {
        written.push(text)
      },
      on: (_e, cb) => {
        stdinErr.push(cb)
      }
    },
    stdout: {
      on: (_e, cb) => {
        dataCbs.push(cb)
      }
    },
    on: (event: 'close' | 'error', cb: never) => {
      on[event].push(cb)
    },
    data: (chunk) => {
      for (const cb of dataCbs) cb(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    },
    close: (code) => {
      for (const cb of on.close) cb(code)
    },
    fail: () => {
      for (const cb of on.error) cb()
    },
    stdinFail: () => {
      for (const cb of stdinErr) cb()
    }
  }
}

function handTimers(): {
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  advance(ms: number): void
  pending(): number
} {
  let now = 0
  let next = 0
  const live = new Map<number, { fn: () => void; at: number }>()
  return {
    setTimer: (fn, ms) => {
      next += 1
      live.set(next, { fn, at: now + ms })
      return next
    },
    clearTimer: (h) => {
      live.delete(Number(h))
    },
    advance: (ms) => {
      const until = now + ms
      for (;;) {
        const due = [...live.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        live.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
    pending: () => live.size
  }
}

const COMMAND = "'/opt/bin/claude' -p --model 'haiku'"
const ENV = { PATH: '/usr/bin', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }

let child: FakeChild
let timers: ReturnType<typeof handTimers>
let kills: [number, string][]
let spawns: unknown[][]
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  child = fakeChild(4242)
  timers = handTimers()
  kills = []
  spawns = []
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  warn.mockRestore()
})

const spawnFake: SpawnSeam = (file, args, options) => {
  spawns.push([file, args, options])
  return child
}
const run = (
  over: { spawn?: SpawnSeam; kill?: (pid: number, s: 'SIGTERM' | 'SIGKILL') => void } = {}
): ReturnType<typeof runExtractCall> =>
  runExtractCall(
    {
      spawn: over.spawn ?? spawnFake,
      shell: '/bin/bash',
      cwd: '/data/memory-extract',
      env: ENV,
      command: COMMAND,
      timeoutMs: EXTRACT_LIMITS.timeoutMs,
      killGraceMs: EXTRACT_LIMITS.killGraceMs,
      stdoutBytes: EXTRACT_LIMITS.stdoutBytes,
      kill:
        over.kill ??
        ((pid, s) => {
          kills.push([pid, s])
        }),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    },
    'THE SLICE'
  )

describe('runExtractCall', () => {
  it('spawns a login shell in its own group, with the command as its one -c argument', () => {
    run()
    expect(spawns).toEqual([
      [
        '/bin/bash',
        ['-l', '-c', COMMAND],
        { cwd: '/data/memory-extract', env: ENV, detached: true, stdio: ['pipe', 'pipe', 'ignore'] }
      ]
    ])
  })

  it('writes the input to stdin and resolves with the parsed output on exit 0', async () => {
    const call = run()
    expect(child.written).toEqual(['THE SLICE'])
    const line = Buffer.from('motd\n' + envelope(output) + '\n')
    child.data(line.subarray(0, 20))
    child.data(line.subarray(20))
    child.close(0)
    await expect(call.result).resolves.toEqual({ ok: true, output })
    expect(kills).toEqual([])
    expect(timers.pending()).toBe(0)
  })

  it('joins a multi-byte character split across two chunks', async () => {
    const withAccent: ExtractOutput = { ...output, note: 'café' }
    const bytes = Buffer.from(envelope(withAccent))
    const at = bytes.indexOf(Buffer.from('é')) + 1
    const call = run()
    child.data(bytes.subarray(0, at))
    child.data(bytes.subarray(at))
    child.close(0)
    await expect(call.result).resolves.toEqual({ ok: true, output: withAccent })
  })

  it('exit 0 with a bad envelope is an envelope failure', async () => {
    const call = run()
    child.data('oops')
    child.close(0)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'envelope', issue: null })
  })

  it.each([1, 143, null])(
    'a non-zero exit (%s) is a failed call, even with a good envelope',
    async (code) => {
      const call = run()
      child.data(envelope(output))
      child.close(code)
      await expect(call.result).resolves.toEqual({ ok: false, reason: 'exit', issue: null })
      expect(timers.pending()).toBe(0)
    }
  )

  it('does not resolve before the child exits', async () => {
    const call = run()
    child.data(envelope(output))
    const seen = vi.fn()
    void call.result.then(seen)
    await Promise.resolve()
    expect(seen).not.toHaveBeenCalled()
    expect(timers.pending()).toBe(1)
  })

  it('kills the process group after the timeout, then harder after the grace time', async () => {
    const call = run()
    timers.advance(119_999)
    expect(kills).toEqual([])
    timers.advance(1)
    expect(kills).toEqual([[-4242, 'SIGTERM']])
    timers.advance(5_000)
    expect(kills).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL']
    ])
    child.close(null)
    await expect(call.result).resolves.toMatchObject({ ok: false, reason: 'timeout' })
    expect(timers.pending()).toBe(0)
  })

  it('a child that exits on SIGTERM is not killed again', async () => {
    const call = run()
    timers.advance(120_000)
    child.close(143)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'timeout', issue: null })
    timers.advance(60_000)
    expect(kills).toEqual([[-4242, 'SIGTERM']])
    expect(timers.pending()).toBe(0)
  })

  it('a child that never exits, even after SIGKILL, still ends the call one grace time later', async () => {
    const call = run()
    timers.advance(120_000 + 5_000)
    const seen = vi.fn()
    void call.result.then(seen)
    timers.advance(4_999)
    await Promise.resolve()
    expect(seen).not.toHaveBeenCalled()
    timers.advance(1)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'timeout', issue: null })
    expect(timers.pending()).toBe(0)
    child.close(null)
    expect(kills).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL']
    ])
  })

  it('cancel kills the group and resolves as cancelled, once', async () => {
    const call = run()
    call.cancel()
    call.cancel()
    expect(kills).toEqual([[-4242, 'SIGTERM']])
    timers.advance(5_000)
    call.cancel()
    expect(kills).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL']
    ])
    child.data(envelope(output))
    child.close(0)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'cancelled', issue: null })
    expect(timers.pending()).toBe(0)
  })

  it('cancel after the exit kills nothing and keeps the result', async () => {
    const call = run()
    child.data(envelope(output))
    child.close(0)
    call.cancel()
    await expect(call.result).resolves.toEqual({ ok: true, output })
    expect(kills).toEqual([])
    expect(timers.pending()).toBe(0)
  })

  it('cancel after a timeout kill keeps the timeout reason', async () => {
    const call = run()
    timers.advance(120_000)
    call.cancel()
    child.close(143)
    await expect(call.result).resolves.toMatchObject({ reason: 'timeout' })
    expect(kills).toEqual([[-4242, 'SIGTERM']])
  })

  it('kills a child whose stdout passes 1 MiB', async () => {
    const call = run()
    child.data(Buffer.alloc(EXTRACT_LIMITS.stdoutBytes, 0x20))
    expect(kills).toEqual([])
    child.data('x')
    expect(kills).toEqual([[-4242, 'SIGTERM']])
    child.data('more')
    expect(kills).toEqual([[-4242, 'SIGTERM']])
    child.close(0)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'exit', issue: null })
    expect(timers.pending()).toBe(0)
  })

  it('a spawn that throws is a failed call, never rejects, and leaves no timer', async () => {
    const call = run({
      spawn: () => {
        throw new Error('spawn EACCES')
      }
    })
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'spawn', issue: null })
    call.cancel()
    expect(kills).toEqual([])
    expect(timers.pending()).toBe(0)
  })

  it('a spawn that gives no pid is a failed call, its later error is taken, and nothing is killed', async () => {
    child = fakeChild(undefined)
    const call = run()
    expect(child.written).toEqual([])
    child.fail()
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'spawn', issue: null })
    call.cancel()
    expect(kills).toEqual([])
    expect(timers.pending()).toBe(0)
  })

  it('a child error after the spawn kills the group and is a spawn failure', async () => {
    const call = run()
    child.fail()
    expect(kills).toEqual([[-4242, 'SIGTERM']])
    child.close(null)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'spawn', issue: null })
    expect(timers.pending()).toBe(0)
  })

  it('a stdin error (the child closed it early) does not end the call by itself', async () => {
    const call = run()
    child.stdinFail()
    expect(kills).toEqual([])
    child.close(1)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'exit', issue: null })
  })

  it('a kill that throws (the group is gone) still ends the call and logs a code only', async () => {
    const call = run({
      kill: (pid, s) => {
        kills.push([pid, s])
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
      }
    })
    call.cancel()
    timers.advance(5_000)
    expect(kills).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL']
    ])
    expect(warn.mock.calls).toEqual([
      ['[claude-watcher][memory] code=memory_extract_kill_failed signal=SIGTERM'],
      ['[claude-watcher][memory] code=memory_extract_kill_failed signal=SIGKILL']
    ])
    timers.advance(5_000)
    await expect(call.result).resolves.toEqual({ ok: false, reason: 'cancelled', issue: null })
    expect(timers.pending()).toBe(0)
  })
})
