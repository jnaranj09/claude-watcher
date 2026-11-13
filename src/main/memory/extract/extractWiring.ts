// The extractor's seams that touch the real world (memory phase 2, Task 11; addendum "The call",
// rulings R16–R18, R25, R35): the model call over the real `spawn` and `process.kill`, the claude
// version gate, and the workspace cascade's memory step. `appExtractor.ts` builds the app's one
// extractor from them (index.ts only hands over its getters and Node's own functions); every
// branch lives here or there so a `main-unit` test reaches it.
//
// SENSITIVE: the slice goes to the child on stdin (`runExtractCall`), never on argv, and nothing
// here logs it, the prompt or the child's output; a log carries a code only.
import { join } from 'node:path'
import { MIN_EXTRACT_CLAUDE_VERSION } from '../../../shared/launch/claudeVersion'
import { EXTRACT_JSON_SCHEMA, EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import type { MemoryModel } from '../../../shared/schemas/settings'
import { locateTranscript, type TranscriptLookupDeps } from '../../pty/claudeTranscript'
import { compareVersions, parseClaudeVersion } from '../../pty/claudeVersion'
import type { OpenedMemory } from '../memoryStartup'
import type { Extractor, ExtractorDeps } from './extractor'
import { EXTRACT_SYSTEM_PROMPT } from './extractPrompt'
import {
  buildExtractEnv,
  composeExtractCommand,
  runExtractCall,
  type ExtractCall,
  type SpawnSeam
} from './headlessClaude'

const LOG_PREFIX = '[claude-watcher][memory]'

/** The call's working folder under userData: the headless claude runs there, never in an
 *  operator's project. */
const EXTRACT_DIR = 'memory-extract'

/** How the folder is made (D8, R36): owned here, so the caller passes Node's `mkdirSync` as is. */
type ExtractDirOptions = { recursive: true; mode: 0o700 }
const EXTRACT_DIR_OPTIONS: ExtractDirOptions = { recursive: true, mode: 0o700 }

/** A call that never started: it ends as `spawn` and signals nothing. */
function spawnFailed(): ExtractCall {
  return {
    result: Promise.resolve({ ok: false, reason: 'spawn', issue: null }),
    cancel: () => undefined,
    killNow: () => undefined
  }
}

/** The real `call`: resolves claude like a launch, composes the command, makes `<userData>/memory-extract`
 *  (0700) when missing, and runs it (`runExtractCall`, with EXTRACT_LIMITS' timeout, grace and stdout cap)
 *  with the real spawn, `process.kill` and the real timer pair.
 *
 *  `mkdir` is called as `mkdir(dir, { recursive: true, mode: 0o700 })` (R36: the mode lives here;
 *  `mkdirSync` fits as is) and is a no-op when the folder exists. A throw from `userData`, `mkdir`,
 *  `resolveClaude` or `env` is a `spawn` failure: nothing spawns, nothing is signalled, and
 *  nothing throws to the extractor. `env` is the sessions' base env (`buildPtyEnv`);
 *  the child gets it through `buildExtractEnv` (no CLAUDECODE, no CLAUDE_WATCHER_*, R18). */
export function createExtractCall(deps: {
  shell: string
  userData: () => string
  env: () => Record<string, string>
  resolveClaude: () => { command: string; dir: string | null }
  spawn: SpawnSeam
  /** `groupId` is already the negated process-group id (`-pid`, -2 or lower): pass it to
   *  `process.kill` unchanged, never negate it again. */
  kill: (groupId: number, signal: 'SIGTERM' | 'SIGKILL') => void
  mkdir: (dir: string, options: ExtractDirOptions) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}): (model: MemoryModel, input: string) => ExtractCall {
  return (model, input) => {
    let cwd: string
    let claude: { command: string; dir: string | null }
    let env: Record<string, string>
    try {
      cwd = join(deps.userData(), EXTRACT_DIR)
      deps.mkdir(cwd, EXTRACT_DIR_OPTIONS)
      claude = deps.resolveClaude()
      env = buildExtractEnv(deps.env(), claude.dir)
    } catch {
      // The extractor gets `spawn`, a failure it tells from every real result, and logs it.
      return spawnFailed()
    }
    return runExtractCall(
      {
        spawn: deps.spawn,
        shell: deps.shell,
        cwd,
        env,
        command: composeExtractCommand({
          claudeCommand: claude.command,
          model,
          systemPrompt: EXTRACT_SYSTEM_PROMPT,
          jsonSchema: EXTRACT_JSON_SCHEMA,
          budgetUsd: EXTRACT_LIMITS.budgetUsd
        }),
        timeoutMs: EXTRACT_LIMITS.timeoutMs,
        killGraceMs: EXTRACT_LIMITS.killGraceMs,
        stdoutBytes: EXTRACT_LIMITS.stdoutBytes,
        kill: deps.kill,
        setTimer: deps.setTimer,
        clearTimer: deps.clearTimer
      },
      input
    )
  }
}

/** The extractor's view of what main holds: the opened memory (null while it is not open: SMOKE,
 *  an unreadable file, after the quit closed it) as `{ store, commands, state }`, and a
 *  transcript's path found by its id (D1; null unless claude surely has it). */
export function extractSources(deps: {
  memory: () => Pick<OpenedMemory, 'store' | 'commands' | 'extractState'> | null
  lookup: () => TranscriptLookupDeps
}): Pick<ExtractorDeps, 'memory' | 'locate'> {
  return {
    memory: () => {
      const opened = deps.memory()
      if (opened === null) return null
      return { store: opened.store, commands: opened.commands, state: opened.extractState }
    },
    locate: (sessionId) => {
      const found = locateTranscript(deps.lookup(), sessionId)
      return found.kind === 'found' ? found.path : null
    }
  }
}

/** The real timer pair `createExtractCall` takes, typed `unknown` at the seam with no cast:
 *  `clearTimer` clears only a handle its own `setTimer` returned and that has not fired or been
 *  cleared; any other value is ignored. */
export function createTimerPair(): {
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
} {
  const live = new Set<ReturnType<typeof setTimeout>>()
  return {
    setTimer: (fn, ms) => {
      const handle = setTimeout(() => {
        live.delete(handle)
        fn()
      }, ms)
      live.add(handle)
      return handle
    },
    clearTimer: (handle) => {
      for (const own of live) {
        if (own !== handle) continue
        clearTimeout(own)
        live.delete(own)
      }
    }
  }
}

/** A raw `--version` answer is good enough to save with: it reads at or above
 *  MIN_EXTRACT_CLAUDE_VERSION, or it cannot be read (fail open). */
function extractVersionOk(raw: string | null): boolean {
  const version = raw === null ? null : parseClaudeVersion(raw)
  return version === null || compareVersions(version, MIN_EXTRACT_CLAUDE_VERSION) >= 0
}

/** Ruling R35 (D41): false only when the version reads and is below MIN_EXTRACT_CLAUDE_VERSION. An OK answer
 *  (a version at or above the floor, or one that cannot be read: fail open) is kept for the whole run, so
 *  `readRaw` runs once however many jobs ask. A not-OK answer is NOT kept and there is no retry: the next
 *  call reads again. The extractor alone remembers a not-OK answer, for 10 minutes (R31), and asks at most
 *  once per job (R7).
 *
 *  Ruling R37: `heldRaw` is the answer the session-launch path already read this run (undefined when
 *  it has read none). An OK held answer is used and kept with no read of its own, so a save after a
 *  launch runs no second blocking login-shell `--version`. A not-OK held answer is not trusted: the
 *  gate reads again, so a claude upgraded since can save. */
export function createExtractVersionGate(
  readRaw: () => string | null,
  heldRaw: () => string | null | undefined = () => undefined
): () => boolean {
  let ok = false
  return () => {
    if (ok) return true
    const held = heldRaw()
    if (held !== undefined && extractVersionOk(held)) {
      ok = true
      return true
    }
    if (!extractVersionOk(readRaw())) return false
    ok = true
    return true
  }
}

/** The workspace cascade's memory step: `forgetWorkspace` first (it cancels the jobs of the rows it removes),
 *  then the database's `removeByWorkspace`. Either side null: skipped. Never throws. */
export function memoryCascadeStep(
  extractor: () => Pick<Extractor, 'forgetWorkspace'> | null,
  memory: () => Pick<OpenedMemory, 'removeByWorkspace'> | null
): { removeByWorkspace(workspaceId: string): void } {
  return {
    removeByWorkspace(workspaceId) {
      // The delete is already committed and nothing can show a failure here: a code is the floor,
      // and the rows still go when the extractor step failed.
      try {
        extractor()?.forgetWorkspace(workspaceId)
      } catch {
        console.warn(`${LOG_PREFIX} code=memory_cascade_failed step=forget`)
      }
      try {
        memory()?.removeByWorkspace(workspaceId)
      } catch {
        console.warn(`${LOG_PREFIX} code=memory_cascade_failed step=rows`)
      }
    }
  }
}
