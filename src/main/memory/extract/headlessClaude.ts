// The headless model call (addendum "The call", D7–D12): one `claude -p` through `$SHELL -l -c`,
// in its own process group, with the slice on stdin. The flag set is the probed one: without
// `--setting-sources ''` the operator's own hooks fired; with it, `--no-session-persistence` and
// `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, the call fired no hook, wrote no transcript and made no
// auto-memory folder. `command` holds main's fixed strings only; nothing from a session (name,
// folder, prompt, slice) is ever on argv, which other processes can read.
//
// Every path ends exactly once, with no child signalled after it exited, a child with no pid never
// signalled at all, and no timer left:
// exit 0 → the parsed result; another exit → `exit`; no exit in `timeoutMs` → `timeout`; stdout
// past `stdoutBytes` or a stdout read error → `exit`; a spawn error, no pid or no stdio streams →
// `spawn`; `cancel()` → `cancelled`. Nothing throws out of `runExtractCall`. A kill sends SIGTERM to the group, SIGKILL `killGraceMs` later, and the call ends at the child's
// close, or `killGraceMs` after the SIGKILL when even that close never comes. `killNow()` (app
// quit) sends the SIGKILL at once. A kill stops reading stdout, and stdout is held only up to
// `stdoutBytes`, so a flood is never buffered.
//
// SENSITIVE: stdin (the slice) and stdout (the model's output) are never logged; a log carries a
// code only. The real `spawn` and `process.kill` are injected by the caller.
import type { MemoryModel } from '../../../shared/schemas/settings'
import {
  ClaudeResultSchema,
  ExtractOutputSchema,
  type ExtractOutput
} from '../../../shared/schemas/memoryExtract'
import { loginShellRun, prependToPath, shellQuote } from '../../pty/claudeBin'

export type ExtractCallFailure = 'spawn' | 'timeout' | 'exit' | 'envelope' | 'output' | 'cancelled'
export type ExtractCallResult =
  | { ok: true; output: ExtractOutput }
  /** `issue`: the Zod path and code of an `output` failure, never a value; null for the rest. */
  | { ok: false; reason: ExtractCallFailure; issue: { path: string; code: string } | null }
export interface ExtractCall {
  result: Promise<ExtractCallResult>
  /** SIGTERM to the process group, SIGKILL `killGraceMs` later; the result is `cancelled`. */
  cancel(): void
  /** SIGKILL to the process group at once, synchronously: the app's quit calls it (Task 11), since
   *  a timer would die with the app and the detached group would not. Does nothing after the call
   *  ended or once a SIGKILL went out. The result is `cancelled`, or the reason of a kill already
   *  under way. */
  killNow(): void
}

/** The command for `$SHELL -l -c` (run through `loginShellRun`), every value through `shellQuote`:
 *  '<claude>' -p --model '<model>' --output-format json --json-schema '<schema>' --system-prompt '<prompt>'
 *  --no-session-persistence --setting-sources '' --tools '' --strict-mcp-config --disable-slash-commands
 *  --max-budget-usd <budgetUsd> */
export function composeExtractCommand(spec: {
  claudeCommand: string
  model: MemoryModel
  systemPrompt: string
  jsonSchema: string
  budgetUsd: number
}): string {
  return [
    shellQuote(spec.claudeCommand),
    '-p',
    '--model',
    shellQuote(spec.model),
    '--output-format',
    'json',
    '--json-schema',
    shellQuote(spec.jsonSchema),
    '--system-prompt',
    shellQuote(spec.systemPrompt),
    '--no-session-persistence',
    '--setting-sources',
    shellQuote(''),
    '--tools',
    shellQuote(''),
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-budget-usd',
    String(spec.budgetUsd)
  ].join(' ')
}

/** Every variable the app itself owns starts with this: the memory and mod markers
 *  (`CLAUDE_WATCHER_MEMORY`, `CLAUDE_WATCHER_MOD_URL`), the profile, the claude path override. */
const WATCHER_PREFIX = 'CLAUDE_WATCHER_'
/** Set when the app itself was started from a claude terminal; `buildPtyEnv` keeps it for
 *  sessions, but the headless call was probed without it. */
const CLAUDECODE = 'CLAUDECODE'

/** `base` without CLAUDE_WATCHER_MEMORY and CLAUDE_WATCHER_MOD_URL (and every other
 *  `CLAUDE_WATCHER_*`) and without CLAUDECODE, with CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 and `claudeDir` first in PATH.
 *  `base` is already `buildPtyEnv()` (no CLAUDE_CODE_*). */
export function buildExtractEnv(
  base: Readonly<Record<string, string>>,
  claudeDir: string | null
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (k !== CLAUDECODE && !k.startsWith(WATCHER_PREFIX)) env[k] = v
  }
  const path = prependToPath(claudeDir, env.PATH)
  if (path !== undefined) env.PATH = path
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  return env
}

const failed = (
  reason: ExtractCallFailure,
  issue: { path: string; code: string } | null = null
): ExtractCallResult => ({ ok: false, reason, issue })

/** The last stdout line that starts with `{` → ClaudeResultSchema → `is_error === false` and a
 *  `structured_output` that passes ExtractOutputSchema. Else 'envelope' or 'output'.
 *  A test keeps this export on purpose. */
export function parseClaudeResult(stdout: string): ExtractCallResult {
  const line = stdout
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .at(-1)
  if (line === undefined) return failed('envelope')
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    // Not JSON: the caller gets `envelope`, a failure it tells from every real result.
    return failed('envelope')
  }
  const envelope = ClaudeResultSchema.safeParse(json)
  if (!envelope.success) return failed('envelope')
  if (envelope.data.is_error || envelope.data.structured_output === undefined) {
    return failed('envelope')
  }
  const output = ExtractOutputSchema.safeParse(envelope.data.structured_output)
  if (output.success) return { ok: true, output: output.data }
  const issue = output.error.issues[0]
  return failed('output', {
    path: issue?.path.map(String).join('.') ?? '',
    code: issue?.code ?? ''
  })
}

/** Holds stdout up to `cap` bytes. The chunk that would pass the cap is not kept, and `push` answers
 *  false, so nothing past the cap is ever buffered. Exported for its own test, which pins the
 *  bytes held. */
export function boundedCollector(cap: number): {
  push(chunk: Buffer): boolean
  held(): number
  text(): string
} {
  const chunks: Buffer[] = []
  let held = 0
  return {
    push: (chunk) => {
      if (held + chunk.length > cap) return false
      chunks.push(chunk)
      held += chunk.length
      return true
    },
    held: () => held,
    // Joined before decoding, so a multi-byte character split across two chunks stays whole.
    text: () => Buffer.concat(chunks).toString('utf8')
  }
}

/** A pid the call may signal: an integer over 1. `0`, a negative or no pid would reach the OS as
 *  "my own group" or worse, and `1` as `-1`, every process of the user (R51), so such a child is
 *  never signalled. */
const signallable = (pid: number | undefined): pid is number =>
  pid !== undefined && Number.isInteger(pid) && pid > 1

/** What the call needs of a spawned child; Node's `ChildProcess` from `spawn` with
 *  `stdio: ['pipe', 'pipe', 'ignore']` fits it as is (a type test pins that). It has no `kill`:
 *  Node's `child.kill()` on a child with no pid was seen to SIGKILL the caller's own process group,
 *  so every signal goes through `deps.kill` with a checked pid. `pid` is optional
 *  there: Node leaves it unset when the spawn failed. `close` (not `exit`): it fires after stdout is
 *  drained, so the parse sees every byte. */
export interface ChildSeam {
  pid?: number | undefined
  /** Missing when Node ran out of file descriptors at the spawn (EMFILE, ENFILE), whatever its
   *  types say. */
  stdin?:
    | { end(text: string): void; on(event: 'error', cb: () => void): void; destroy(): void }
    | null
    | undefined
  stdout?:
    | {
        on(event: 'data', cb: (chunk: Buffer) => void): void
        on(event: 'error', cb: () => void): void
        destroy(): void
      }
    | null
    | undefined
  on(event: 'close', cb: (code: number | null) => void): void
  on(event: 'error', cb: () => void): void
}
export type SpawnSeam = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string
    env: Record<string, string>
    detached: true
    stdio: ['pipe', 'pipe', 'ignore']
  }
) => ChildSeam

/** Spawns `shell -l -c command` in its own process group, writes `input` to stdin and closes it. Resolves
 *  once, never rejects, never throws: exit 0 → parseClaudeResult; another exit → 'exit'; no exit after
 *  `timeoutMs` → SIGTERM to the group (`kill(-pid)`), SIGKILL after `killGraceMs`, 'timeout'; stdout over
 *  `stdoutBytes` or a stdout error → killed, 'exit'; a spawn error, no pid or no stdin / stdout →
 *  'spawn'; `cancel()` → killed the same way, 'cancelled';
 *  `killNow()` → SIGKILL at once, 'cancelled' unless a kill had already started. */
export function runExtractCall(
  deps: {
    spawn: SpawnSeam
    shell: string
    cwd: string
    env: Record<string, string>
    command: string
    timeoutMs: number
    killGraceMs: number
    stdoutBytes: number
    /** Called with the negated process-group id (`-pid` of a positive-integer pid), never a pid. */
    kill: (groupId: number, signal: 'SIGTERM' | 'SIGKILL') => void
    setTimer: (fn: () => void, ms: number) => unknown
    clearTimer: (handle: unknown) => void
  },
  input: string
): ExtractCall {
  let settle: (r: ExtractCallResult) => void = () => undefined
  const result = new Promise<ExtractCallResult>((resolve) => {
    settle = resolve
  })
  let done = false
  /** Set once a kill starts: the reason the call ends with, whatever the child then exits with. */
  let killedFor: ExtractCallFailure | null = null
  let sigkillSent = false
  let timer: unknown = null
  let child: ChildSeam | null = null
  const out = boundedCollector(deps.stdoutBytes)

  const clear = (): void => {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }
  /** A second call (a close after the last timer ended the call) changes nothing: the promise
   *  keeps its first value and no timer is left to clear. */
  const finish = (r: ExtractCallResult): void => {
    done = true
    clear()
    settle(r)
  }
  /** The child's process group, only when its pid is signallable; a child with no pid (or a bad
   *  one) is never signalled, by any path. Its callers (`stop`, `killNow`, the SIGKILL timer) never
   *  run after the call ended, so a pid the system gave to another process since is never
   *  signalled. */
  const signal = (s: 'SIGTERM' | 'SIGKILL'): void => {
    const pid = child?.pid
    if (!signallable(pid)) return
    try {
      deps.kill(-pid, s)
    } catch {
      // ESRCH: the group is already gone; its close (or the last timer) still ends the call.
      console.warn(`[claude-watcher][memory] code=memory_extract_kill_failed signal=${s}`)
    }
  }
  /** SIGKILL now; the call ends at the close, or one grace time later when no close comes. */
  const sigkill = (): void => {
    sigkillSent = true
    clear()
    signal('SIGKILL')
    timer = deps.setTimer(() => {
      timer = null
      finish(failed(killedFor ?? 'cancelled'))
    }, deps.killGraceMs)
  }
  /** Marks the kill's reason (the first one wins) and stops reading stdout: nothing after a kill
   *  is buffered. */
  const startKill = (why: ExtractCallFailure): void => {
    killedFor = why
    child?.stdout?.destroy()
  }
  /** SIGTERM to the group now, SIGKILL after the grace time. Once per call; never after it ended. */
  const stop = (why: ExtractCallFailure): void => {
    if (done || killedFor !== null) return
    startKill(why)
    clear()
    signal('SIGTERM')
    timer = deps.setTimer(sigkill, deps.killGraceMs)
  }
  const call: ExtractCall = {
    result,
    cancel: () => stop('cancelled'),
    killNow: () => {
      if (done || sigkillSent) return
      if (killedFor === null) startKill('cancelled')
      sigkill()
    }
  }

  try {
    // A non-POSIX login shell (fish) gets the command through the env, never parsed by it.
    const run = loginShellRun(deps.shell, deps.command)
    child = deps.spawn(deps.shell, run.args, {
      cwd: deps.cwd,
      env: { ...deps.env, ...run.env },
      detached: true,
      stdio: ['pipe', 'pipe', 'ignore']
    })
  } catch {
    // The caller gets `spawn`, a failure it tells from every real result, and logs it.
    finish(failed('spawn'))
    return call
  }
  const spawned = child
  try {
    // Listened to before anything else: an 'error' with no listener would throw in main.
    spawned.on('error', () => {
      if (signallable(spawned.pid)) stop('spawn')
      else finish(failed('spawn'))
    })
    const { stdin, stdout } = spawned
    // Taken on every path, a failed spawn's streams included: an unheard stream 'error' would
    // throw in main.
    stdin?.on('error', () => {
      // EPIPE: the child closed stdin early. Its close decides the result; nothing to do here.
    })
    stdout?.on('error', () => stop('exit'))
    // Node leaves no pid when the spawn failed (ENOENT), and no stdio streams at all when it ran
    // out of file descriptors (EMFILE, ENFILE). Either is a spawn failure (R25): close what streams
    // there are and signal nothing.
    if (!signallable(spawned.pid) || !stdin || !stdout) {
      stdin?.destroy()
      stdout?.destroy()
      finish(failed('spawn'))
      return call
    }
    stdout.on('data', (chunk) => {
      if (!out.push(chunk)) stop('exit')
    })
    spawned.on('close', (code) => {
      if (killedFor !== null) finish(failed(killedFor))
      else if (code === 0) finish(parseClaudeResult(out.text()))
      else finish(failed('exit'))
    })
    timer = deps.setTimer(() => {
      timer = null
      stop('timeout')
    }, deps.timeoutMs)
    stdin.end(input)
  } catch {
    // A child that breaks its own contract: the caller gets `spawn`, a failure it tells from every
    // real result. With a pid the group is killed and the call ends at its close (or the timers).
    if (signallable(spawned.pid)) stop('spawn')
    else finish(failed('spawn'))
  }
  return call
}
