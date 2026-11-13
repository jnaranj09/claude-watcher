// The headless model call (addendum "The call", D7–D12): one `claude -p` through `$SHELL -l -c`,
// in its own process group, with the slice on stdin. The flag set is the probed one: without
// `--setting-sources ''` the operator's own hooks fired; with it, `--no-session-persistence` and
// `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, the call fired no hook, wrote no transcript and made no
// auto-memory folder. `command` holds main's fixed strings only; nothing from a session (name,
// folder, prompt, slice) is ever on argv, which other processes can read.
//
// Every path ends exactly once, with no child signalled after it exited and no timer left:
// exit 0 → the parsed result; another exit → `exit`; no exit in `timeoutMs` → `timeout`; stdout
// past `stdoutBytes` → `exit`; a spawn error or no pid → `spawn`; `cancel()` → `cancelled`. A
// kill sends SIGTERM to the group, SIGKILL `killGraceMs` later, and the call ends at the child's
// close, or `killGraceMs` after the SIGKILL when even that close never comes.
//
// SENSITIVE: stdin (the slice) and stdout (the model's output) are never logged; a log carries a
// code only. The real `spawn` and `process.kill` are injected by the caller.
import type { MemoryModel } from '../../../shared/schemas/settings'
import {
  ClaudeResultSchema,
  ExtractOutputSchema,
  type ExtractOutput
} from '../../../shared/schemas/memoryExtract'
import { prependToPath, shellQuote } from '../../pty/claudeBin'

export type ExtractCallFailure = 'spawn' | 'timeout' | 'exit' | 'envelope' | 'output' | 'cancelled'
export type ExtractCallResult =
  | { ok: true; output: ExtractOutput }
  /** `issue`: the Zod path and code of an `output` failure, never a value; null for the rest. */
  | { ok: false; reason: ExtractCallFailure; issue: { path: string; code: string } | null }
export interface ExtractCall {
  result: Promise<ExtractCallResult>
  cancel(): void
}

/** The command for `$SHELL -l -c`, every value through `shellQuote`:
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

/** `base` without CLAUDE_WATCHER_MEMORY and CLAUDE_WATCHER_MOD_URL (and every other
 *  `CLAUDE_WATCHER_*`), with CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 and `claudeDir` first in PATH.
 *  `base` is already `buildPtyEnv()` (no CLAUDE_CODE_*). */
export function buildExtractEnv(
  base: Readonly<Record<string, string>>,
  claudeDir: string | null
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (!k.startsWith(WATCHER_PREFIX)) env[k] = v
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
 *  `structured_output` that passes ExtractOutputSchema. Else 'envelope' or 'output'. */
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

/** What the call needs of a spawned child. `close` (not `exit`): it fires after stdout is drained,
 *  so the parse sees every byte. */
export interface ChildSeam {
  pid: number | undefined
  stdin: { end(text: string): void; on(event: 'error', cb: () => void): void }
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): void }
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
 *  once, never rejects: exit 0 → parseClaudeResult; another exit → 'exit'; no exit after `timeoutMs` →
 *  SIGTERM to the group (`kill(-pid)`), SIGKILL after `killGraceMs`, 'timeout'; stdout over `stdoutBytes`
 *  → killed, 'exit'; a spawn error or no pid → 'spawn'; `cancel()` → killed the same way, 'cancelled'. */
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
    kill: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
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
  let timer: unknown = null
  let pid: number | undefined = undefined
  const chunks: Buffer[] = []
  let bytes = 0

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
  const signal = (s: 'SIGTERM' | 'SIGKILL'): void => {
    // Narrows the type only: `stop` runs once `pid` is set (a call that never got one is done).
    if (pid === undefined) return
    try {
      deps.kill(-pid, s)
    } catch {
      // ESRCH: the group is already gone; its close (or the last timer) still ends the call.
      console.warn(`[claude-watcher][memory] code=memory_extract_kill_failed signal=${s}`)
    }
  }
  /** SIGTERM to the group now, SIGKILL after the grace time, and the call ends at the close or one
   *  more grace time after the SIGKILL. Once per call; never after the call ended. */
  const stop = (why: ExtractCallFailure): void => {
    if (done || killedFor !== null) return
    killedFor = why
    clear()
    signal('SIGTERM')
    timer = deps.setTimer(() => {
      signal('SIGKILL')
      timer = deps.setTimer(() => {
        timer = null
        finish(failed(why))
      }, deps.killGraceMs)
    }, deps.killGraceMs)
  }
  const call: ExtractCall = { result, cancel: () => stop('cancelled') }

  let child: ChildSeam
  try {
    child = deps.spawn(deps.shell, ['-l', '-c', deps.command], {
      cwd: deps.cwd,
      env: deps.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'ignore']
    })
  } catch {
    // The caller gets `spawn`, a failure it tells from every real result, and logs it.
    finish(failed('spawn'))
    return call
  }
  // Listened to before anything else: an 'error' with no listener would throw in main.
  child.on('error', () => {
    if (pid === undefined) finish(failed('spawn'))
    else stop('spawn')
  })
  child.stdin.on('error', () => {
    // EPIPE: the child closed stdin early. Its close decides the result; nothing to do here.
  })
  if (child.pid === undefined) {
    finish(failed('spawn'))
    return call
  }
  pid = child.pid
  child.stdout.on('data', (chunk) => {
    if (done || killedFor !== null) return
    bytes += chunk.length
    if (bytes > deps.stdoutBytes) {
      stop('exit')
      return
    }
    chunks.push(chunk)
  })
  child.on('close', (code) => {
    if (killedFor !== null) finish(failed(killedFor))
    else if (code === 0) finish(parseClaudeResult(Buffer.concat(chunks).toString('utf8')))
    else finish(failed('exit'))
  })
  timer = deps.setTimer(() => {
    timer = null
    stop('timeout')
  }, deps.timeoutMs)
  child.stdin.end(input)
  return call
}
