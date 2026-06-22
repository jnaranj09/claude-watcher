// Story 1.1 — the c9watch FEED (main process only).
//
// Owns the long-lived `c9watch watch --changes-only` child: spawns it (through an
// INJECTED `spawnFn` DI seam — NEVER a deep vi.mock of child_process), splits its
// stdout into complete NDJSON lines (holding a partial trailing fragment across
// chunks), and hands each RAW line to the reducer (the reducer owns the ONE Zod
// boundary — the feed never parses). On the watch child exiting it AUTO-RECONNECTS:
// drain → restart → fresh `list` snapshot → diff vs the reducer's map → emit the
// reconcile deltas, so no transition is lost across the gap (NFR-2).
//
// never-crash discipline: every child AND its stdout stream gets an 'error' handler;
// a malformed `list` during reconnect is CAUGHT (the feed backs off — it does not
// escape). Lifecycle is owned by an AbortController: stop()/reconnect aborts-and-
// replaces the controller so there are no stacked listeners and no leaked child.
// A watch reconnect NEVER touches PTY state (feed and terminals are independent).
// [Source: story 1.1 Tasks 1/4; architecture.md#Process Patterns
//  (AbortController ownership; attach 'error' to every child/stream); #Communication
//  /State Patterns (on watch exit → drain → restart → list → diff); #Testing & Test
//  Seams (feed.ts(spawnFn)); .claude/rules/state.md]
import { spawn, execFileSync } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { Reducer, SessionDelta } from './reducer'

/** The minimal shape the feed needs from a spawned child — a structural subset of
 *  Node's `ChildProcess`, so the real `child_process.spawn` satisfies it AND a fake
 *  is trivial. The feed listens for 'error'/'exit' on the child and 'data'/'error'
 *  on `stdout`, and calls `kill()` to reap it. */
export interface SpawnedChild {
  stdout: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
    on(event: 'error', listener: (err: Error) => void): unknown
  } | null
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(signal?: NodeJS.Signals | number): boolean
}

/** The spawn DI seam — defaults to spawning the real `c9watch watch --changes-only`. */
export type SpawnFn = () => SpawnedChild

/** The `list` DI seam — returns the raw `c9watch list` snapshot (sync or async).
 *  Production runs the real CLI; tests inject `fakeListSnapshot`. The reducer parses
 *  it (and THROWS on a malformed envelope — the feed catches that and backs off). */
export type ListFn = () => unknown | Promise<unknown>

export interface FeedOptions {
  /** Spawn the `watch` child. DI seam. Defaults to the real c9watch spawn. */
  spawnFn?: SpawnFn
  /** Run `c9watch list`. DI seam. Defaults to the real c9watch exec. */
  listFn?: ListFn
  /** The reducer that owns the session map + the Zod boundary. */
  reducer: Reducer
  /** Sink for every session delta (snapshot reconcile + watch line). Push to the
   *  renderer here (e.g. `wc.send(CH.watchEvents, delta)`). */
  onDelta: (delta: SessionDelta) => void
  /** Optional sink for the feed's CONNECTION state (Story 1.4 fix). Called with
   *  `true` when the watch child dies and a reconnect starts, and `false` once the
   *  reconnect settles (watch restarted + `list` reconcile applied). The renderer's
   *  reconnect banner is driven by THIS real signal, NOT by line silence (a quiet
   *  `watch --changes-only` emits 0 lines — silence is the normal steady state).
   *  Push to the renderer here (e.g. `wc.send(CH.watchStatus, { reconnecting })`). */
  onStatus?: (status: { reconnecting: boolean }) => void
  /** Epoch-millis clock — injected for determinism (unused timing today, reserved
   *  for back-off scheduling). */
  now?: () => number
  /** Optional reconnect back-off in ms (default 0 — immediate; injected small in
   *  tests). A real deployment may set a few hundred ms. */
  reconnectDelayMs?: number
}

export interface Feed {
  /** Spawn the watch child and run the initial `list` seed (emits seed deltas). */
  start(): Promise<void>
  /** Abort the controller, kill the current child, stop reconnecting. Idempotent. */
  stop(): Promise<void>
  /** Resolve once any in-flight reconnect settles (for deterministic tests). */
  whenReconnected(): Promise<void>
}

const WATCH_ARGS = ['watch', '--changes-only'] as const

/** Default spawn — the real `c9watch watch --changes-only` child.
 *
 *  stderr is IGNORED (redirected to /dev/null), NOT piped: a piped stderr would be
 *  a live Readable that can emit an unhandled `'error'` and crash the process
 *  (never-crash: every OPEN stream needs an 'error' handler — so we open only the
 *  one we read, `stdout`). This keeps `SpawnedChild` an accurate contract: the feed
 *  reads `stdout` only. */
function defaultSpawn(): SpawnedChild {
  return spawn('c9watch', [...WATCH_ARGS], { stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Default list — run the real `c9watch list` and JSON-parse its stdout. A parse
 *  failure throws; the caller (reconnect/start) catches + backs off.
 *
 *  never-log-the-parsed-value: a bare `JSON.parse` of malformed CLI output throws a
 *  V8 `SyntaxError` whose message EMBEDS a window of the raw input (which carries
 *  prompts / PTY content / secrets), and the caller logs `err.message`. So we
 *  swallow the SyntaxError and rethrow a VALUE-FREE error — mirroring the reducer's
 *  `parseJsonValueFree` and Story-0.5's `parseJsonOrDrift`.
 *  [.claude/rules/zod-boundaries.md#Never-log-the-parsed-value] */
function defaultList(): unknown {
  const out = execFileSync('c9watch', ['list'], {
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  })
  try {
    return JSON.parse(out)
  } catch {
    throw new Error('c9watch list: invalid JSON (content suppressed)')
  }
}

export function createFeed(options: FeedOptions): Feed {
  const spawnFn = options.spawnFn ?? defaultSpawn
  const listFn = options.listFn ?? defaultList
  const { reducer, onDelta } = options
  const reconnectDelayMs = options.reconnectDelayMs ?? 0

  /** Surface the feed's connection state to the consumer (Story 1.4 fix). A no-op
   *  if no `onStatus` was provided. never-crash: a throwing consumer must not crash
   *  the feed's lifecycle, so swallow + log (value-free — a boolean carries nothing). */
  function emitStatus(reconnecting: boolean): void {
    try {
      options.onStatus?.({ reconnecting })
    } catch (err) {
      console.error(
        '[c9watch][feed] onStatus sink threw (ignored):',
        err instanceof Error ? err.message : 'unknown'
      )
    }
  }

  let controller: AbortController = new AbortController()
  let child: SpawnedChild | null = null
  let buffer = '' // partial NDJSON fragment carried across stdout chunks
  // A UTF-8 decoder that survives across chunks: a multibyte codepoint (emoji,
  // accented char in sessionName/projectPath/latestMessage) can be split across two
  // OS pipe Buffer chunks. A naive per-chunk `chunk.toString('utf8')` decodes each
  // half independently → the split codepoint becomes U+FFFD replacement chars,
  // silently CORRUPTING the session field (JSON still parses, so it is not even
  // dropped — the garbled value reaches the renderer). StringDecoder buffers the
  // trailing partial bytes until the next chunk completes the codepoint.
  let decoder = new StringDecoder('utf8')
  let stopped = false
  let reconnecting: Promise<void> | null = null

  function emit(deltas: readonly SessionDelta[]): void {
    for (const d of deltas) onDelta(d)
  }

  /** Process a stdout chunk: decode (codepoint-safe), append to the buffer, split on
   *  '\n', apply each COMPLETE line through the reducer, and KEEP the trailing
   *  partial fragment. A '' chunk just re-runs the split (used by the drain). */
  function onChunk(chunk: Buffer | string): void {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    let newlineAt = buffer.indexOf('\n')
    while (newlineAt !== -1) {
      const line = buffer.slice(0, newlineAt)
      buffer = buffer.slice(newlineAt + 1)
      if (line.trim() !== '') {
        // The reducer owns the Zod boundary + never-crash (applyLine never throws).
        emit(reducer.applyLine(line))
      }
      newlineAt = buffer.indexOf('\n')
    }
  }

  /** Spawn a fresh watch child and wire its listeners under the current controller. */
  function spawnChild(): void {
    const signal = controller.signal
    const c = spawnFn()
    child = c

    // never-crash: every child AND its stdout stream gets an 'error' handler so a
    // pipe/spawn error degrades gracefully instead of throwing out of the process.
    c.on('error', (err) => {
      console.error('[c9watch][feed] watch child error', err.message)
    })
    if (c.stdout) {
      c.stdout.on('data', (chunk) => {
        if (signal.aborted) return
        onChunk(chunk)
      })
      c.stdout.on('error', (err) => {
        console.error('[c9watch][feed] watch stdout error', err.message)
      })
    }
    c.on('exit', () => {
      if (signal.aborted || stopped) return // intentional teardown — do not reconnect
      // SERIALIZE reconnects: if a reconnect is already in flight, a SECOND child exit
      // (e.g. the freshly-respawned child dies while we are still `await`ing this
      // reconnect's `list`) must NOT start a nested reconnect. A nested run would
      // abort/replace the controller and `spawnChild()` again mid-flight — clobbering
      // the in-flight `child` reference (orphaning an un-`kill()`-ed watch child) and
      // making `whenReconnected()` non-deterministic. The level-triggered final `list`
      // reconcile still heals any transition missed during this window (AC-3 holds).
      if (reconnecting) return
      // The watch child died and we are starting a real reconnect — surface the REAL
      // connection-state signal (AC-6 / UX-DR17: the banner tracks a watch-stream GAP,
      // not line silence). Cleared by `reconnect()`'s finally once it settles.
      emitStatus(true)
      reconnecting = reconnect().finally(() => {
        reconnecting = null
        emitStatus(false)
      })
    })
  }

  /** AC-3 / NFR-2: drain → restart → fresh list → diff vs the map → emit deltas.
   *  A malformed list THROWS in the reducer; we CATCH it here (back off, stay up).
   *  Serialized by the `reconnecting` guard in the exit handler — exactly one runs
   *  at a time, so the kill-then-respawn below reaps the prior child exactly once. */
  async function reconnect(): Promise<void> {
    // Drain: flush any complete line still buffered from the dying child, then drop
    // the partial fragment (it cannot be completed — the next `list` heals the gap).
    if (buffer.includes('\n')) onChunk('')
    buffer = ''
    // Reset the UTF-8 decoder too: any half-codepoint buffered from the dying child's
    // last chunk must NOT bleed into the restarted child's first chunk.
    decoder = new StringDecoder('utf8')

    // aborts-and-replaces the controller: no stacked listeners, no leaked child.
    // The serialization guard guarantees this kill reaps the ONE prior child exactly
    // once (no nested reconnect can have already replaced `child` underneath us).
    controller.abort()
    try {
      child?.kill()
    } catch {
      /* already gone */
    }
    if (stopped) return
    controller = new AbortController()

    if (reconnectDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, reconnectDelayMs))
    }
    if (stopped) return

    // Restart the watch child FIRST so no live transition is missed while we list.
    spawnChild()
    // Capture the signal of the controller THIS reconnect spawned under, so the
    // post-`await` re-check below tests THIS reconnect's lifecycle (not a later one).
    const signal = controller.signal

    // Fresh list snapshot → diff vs the current map → emit reconcile deltas. A
    // malformed snapshot throws (per-boundary); caught → the feed backs off but the
    // restarted child keeps the stream up.
    try {
      const raw = await listFn()
      // Re-check teardown state AFTER the await: the feed may have been stop()ed (or
      // its controller aborted) WHILE `listFn()` was resolving. Emitting onto a
      // torn-down feed would push deltas after stop(); bail without emitting. The
      // restarted child (if any) is reaped by stop()'s abort+kill.
      if (stopped || signal.aborted) return
      const { deltas } = reducer.seedFromSnapshot(raw)
      emit(deltas)
    } catch (err) {
      console.error(
        '[c9watch][feed] reconnect list reconcile failed (backing off):',
        err instanceof Error ? err.message : 'unknown'
      )
    }
  }

  async function start(): Promise<void> {
    stopped = false
    // Reset transient stream state so a stop()→start() reuse does not prepend a stale
    // partial fragment, bleed a half-codepoint from a prior child, or await a settled
    // reconnect promise. (Latent today — `registerWatchFeed` builds a fresh feed per
    // window and never restarts one — but cheap correctness if that ever changes.)
    buffer = ''
    decoder = new StringDecoder('utf8')
    reconnecting = null
    controller = new AbortController()
    // Seed first: a `list` snapshot stamps the initial epoch + seeds the map.
    // A malformed initial snapshot THROWS to the caller (start-up is the caller's
    // decision point — fail-closed at the `list` boundary).
    const raw = await listFn()
    const { deltas } = reducer.seedFromSnapshot(raw)
    emit(deltas)
    // Story 5.3 — COLD-LOAD-COMPLETE signal: emit a one-time startup status after the
    // initial `list` seed so the renderer can leave the skeleton even when the
    // launched-only ship gate (Story 3.3) produced ZERO board deltas (empty board).
    // Timing is safe: `start()` awaits `listFn()` first, so the renderer's `onStatus`
    // subscription is mounted by the time this fires — the same post-`await` guarantee
    // the seed deltas already rely on. Distinct from the reconnect emits below.
    emitStatus(false)
    // Then attach the live watch stream.
    spawnChild()
  }

  async function stop(): Promise<void> {
    stopped = true
    controller.abort()
    try {
      child?.kill()
    } catch {
      /* already gone */
    }
    await whenReconnected()
  }

  async function whenReconnected(): Promise<void> {
    await reconnecting
  }

  return { start, stop, whenReconnected }
}
