// Story 3.2 (FR-11) — the MAIN-side LAUNCH SERVICE (AC: #1, #2, #3, #4).
//
// Births the in-app launch flow ON TOP of the Story-3.1 embedded terminal: it does NOT
// re-implement the terminal/transport. A launch differs from Story-3.1's shell spawn in
// EXACTLY two ways:
//   (a) file/cwd — spawn raw `claude` in the picked dir (AR-7 raw launch), not `$SHELL` in
//       `$HOME` — passed to the REUSED terminalManager as a per-open spawnOverride; and
//   (b) the post-spawn correlation — bind the app-spawned claude to its c9watch session via
//       the Story-0.4 `pidCorrelation.ts` `Tgid` join (REUSED as-is), keyed on the stable id.
//
// THE OPTIMISTIC CARD + THE JOIN (UX-DR19, F4) — at launch, main holds the PTY (the shell
// leader pid via terminalManager.pidOf) but NOT yet the c9watch session `id` (the join binds
// them). The EmbeddedTerminal opens + is typeable IMMEDIATELY against the opaque terminalId —
// NEVER blocked on the join. The correlation RETRIES on each c9watch feed delta: re-resolve
// the app claude `Tgid` and try to join the not-yet-correlated launches against the current
// snapshot. The reported pid WANDERS — we RE-RESOLVE `Tgid` every time, never cache the raw
// pid as identity (oq-6 caveat #2). When the join firms up, the session `id` enters the
// launched-set (Task 4) — NOT at spawn.
//
// FAIL-CLOSED / NEVER-CRASH — at t0 `resolveClaudeDescendant` returns `CLAUDE_NOT_RESOLVED`
// (claude not spawned/scanned yet — NOT a wrong pid, NOT a crash); `resolveTgid`/`correlate`
// fail closed (`matched:false`) on a gone/denied/malformed `/proc` read. A failed launch /
// failed correlation degrades gracefully — one bad session never takes the board down. The
// `/proc` path NEVER logs the value: pidCorrelation already surfaces only pid + field; the
// call site logs a `code=` only.
//
// LINUX-ONLY — `/proc` is Linux. The correlation gates on `platform === 'linux'` (injected for
// tests; defaults to `process.platform`). On a non-Linux host the launch still works (the PTY
// spawns + the terminal is typeable); only the Tgid join is skipped (the launched-set stays
// empty there — accepted: Story 3.3's filter is Linux-only too, by the same constraint).
//
// DI SEAMS (AR-11) — the spawn is the REUSED ptyFactory (no real node-pty on the unit path);
// the `/proc` readers are the pidCorrelation.ts seams (`ReadStatus`/`ReadComm`/`ListChildren`)
// — inject a fake `/proc` reader; NO live `claude` in unit tests. Mirrors the Story-0.4 test
// pattern + the createTerminalManager/createTrayController DI-seam shape (inject + code-only log).
// [Source: story 3.2 Tasks 2/3/4; F3/F4/F5; AR-7; oq-6-pid-correlation-finding.md §"The
//  correlation contract"; src/main/pty/pidCorrelation.ts; src/main/pty/terminalManager.ts]
import {
  resolveClaudeDescendant,
  resolveTgid,
  correlate,
  CLAUDE_NOT_RESOLVED,
  type ReadStatus,
  type ReadComm,
  type ListChildren
} from './pidCorrelation'
import type { LaunchedSet } from './launchedSet'
import type { Session } from '../../shared/schemas/session'

/** The minimal terminal-manager surface the launch service needs (REUSE — Story 3.1). The
 *  launch SPAWN itself rides the EXISTING `terminal:open` handler in main (the renderer opens the
 *  EmbeddedTerminal against the launch-minted terminalId, which triggers terminal:open → the
 *  manager spawns the PTY with the launch's spawnOverride). So the launch service does NOT call
 *  open() — it only reads the spawned shell leader pid for the correlation walk (pidOf). */
export interface LaunchTerminalManager {
  /** The PTY shell-leader pid for a live terminal (the input to resolveClaudeDescendant). Null
   *  until the terminal is open / once it is gone — the correlation retries on the next delta. */
  pidOf(terminalId: string): number | null
}

/** The launch invocation — raw `claude` in `cwd`. */
export interface LaunchRequest {
  /** The picked working directory (validated upstream at the IPC boundary). */
  cwd: string
}

/** The launch outcome — the opaque terminalId the renderer's EmbeddedTerminal opens against. */
export interface LaunchOutcome {
  terminalId: string
}

export interface LaunchServiceOptions {
  /** The REUSED Story-3.1 terminal manager (one node-pty/terminal behind the MessagePort
   *  transport). The launch spawns through it (file/cwd override) — NOT a second pty path. */
  terminalManager: LaunchTerminalManager
  /** The launched-set this service POPULATES on a landed join (Task 4). */
  launchedSet: LaunchedSet
  /** The raw-claude spawn config (F3). `file` is normally `'claude'` (the direct spawn) with
   *  the documented login-shell fallback supplied by the caller. `env` is the sanitized child
   *  env (buildPtyEnv — strips the smoke vars). */
  spawn: { file: string; args?: string[]; env?: Record<string, string> }
  /** The `/proc` reader seams (pidCorrelation.ts). Inject fakes in unit tests (no live claude);
   *  main injects the production `readStatusFromProc`/`readCommFromProc`/`listChildrenFromProc`. */
  readStatus: ReadStatus
  readComm: ReadComm
  listChildren: ListChildren
  /** Mint a fresh opaque terminalId per launch (NOT the session id, NOT a pid — F6). Injected
   *  for deterministic tests; defaults to a crypto-random id in main. */
  newTerminalId?: () => string
  /** Epoch-millis clock — injected for determinism (the launch timestamp; diagnostics only). */
  now?: () => number
  /** Platform gate — the correlation runs only on `'linux'` (/proc). Injected for tests;
   *  defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Story 3.4 (FR-16) — fired ONCE when a launch's Tgid correlation join LANDS, with the
   *  `{ terminalId, sessionId }` binding. Main pushes it over `CH.launchCorrelated` so the
   *  renderer can build a `terminalIdBySessionId` view-state (the rail switches the visible
   *  terminal by session id). Optional (tests may omit it). The callback is wrapped fail-closed
   *  at the call site so a throw never escapes the per-delta correlation loop (never-crash). */
  onCorrelated?: (binding: { terminalId: string; sessionId: string }) => void
  /** Code-only log sink (Guardrail #6) — NEVER a path/pty/session value. Defaults to console.warn. */
  log?: (message: string) => void
}

/** One in-flight (or completed) app launch awaiting / holding its Tgid correlation. Internal. */
interface PendingLaunch {
  terminalId: string
  /** Epoch-millis the launch spawned (diagnostics). */
  launchedAt: number
  /** Set once the Tgid join lands — the session id this launch correlated to (and the id added
   *  to the launched-set). Until then the launch is App-launched-optimistic (UX-DR19). */
  correlatedId: string | null
}

export interface LaunchService {
  /** Launch raw `claude` in `cwd` (AC-1). Spawns the PTY through the REUSED terminal manager
   *  (file/cwd override) at sane default dims, registers the launch for correlation, and
   *  returns the opaque terminalId. The terminal is typeable IMMEDIATELY (never blocked on the
   *  join). The MessagePort transfer rides the SAME Story-3.1 terminal:open path in main — this
   *  service registers the pending spawnOverride for `terminalId`; main consults it on open. */
  launch(req: LaunchRequest): LaunchOutcome
  /** The DURABLE spawnOverride (file/cwd/env) for a launch terminalId — main reads this on EVERY
   *  terminal:open so the launched terminal spawns `claude` in the picked cwd instead of the
   *  default shell. NON-CONSUMING (Story 5.4): the override is the durable spawn-recipe and
   *  survives reads, stops, and natural exits — so (a) a StrictMode dev double-mount's SURVIVING
   *  open still spawns claude, and (b) Reopen re-spawns claude (never the default `$SHELL`). A
   *  consume-once read was the latent Reopen bug + half of the dev blank-terminal bug. Returns
   *  null for a non-launch terminalId (the Story-3.1 host path). Reclaimed only at process exit. */
  peekSpawnOverride(terminalId: string): {
    file: string
    args?: string[]
    cwd: string
    env?: Record<string, string>
  } | null
  /** Attempt the Tgid join for every not-yet-correlated launch against the current c9watch
   *  snapshot (AC-2/3/4). Called per feed delta (same synchronous tick as the reducer map). A
   *  landed join records the session id in the launched-set. Re-resolves Tgid each call (the
   *  reported pid wanders — never cached). Never throws (fail-closed throughout). */
  correlateAgainst(sessions: Iterable<Session>): void
  /** Whether a terminalId is an app launch still awaiting its correlation join (diagnostics/tests). */
  isPending(terminalId: string): boolean
  /** Drop a launch's CORRELATION tracking (called when its claude exits for real). The durable
   *  spawn-override (the Reopen recipe) is KEPT — see peekSpawnOverride. Idempotent. */
  forget(terminalId: string): void
}

let idCounter = 0
/** Default terminalId minter — opaque + unique per launch. Not an identity key (F6). */
function defaultNewTerminalId(): string {
  idCounter += 1
  return `launch-term-${Date.now().toString(36)}-${idCounter}`
}

/**
 * Build the launch service (AC-1/2/3/4). All external touches are seamed: the spawn rides the
 * injected terminal manager (the ptyFactory DI seam underneath), the `/proc` reads ride the
 * injected pidCorrelation readers, time + ids + platform are injected. Every correlation step
 * is wrapped so one bad session never escapes (never-crash).
 */
export function createLaunchService(options: LaunchServiceOptions): LaunchService {
  const log = options.log ?? ((message: string): void => console.warn(message))
  const now = options.now ?? Date.now
  const newTerminalId = options.newTerminalId ?? defaultNewTerminalId
  const platform = options.platform ?? process.platform

  /** Launches keyed by terminalId. A launch's CORRELATION tracking stays here until forget() (its
   *  claude exits for real); the durable spawn-override below outlives it (see peekSpawnOverride). */
  const launches = new Map<string, PendingLaunch>()
  /** Durable spawn-overrides keyed by terminalId — the spawn-recipe read on EVERY terminal:open
   *  (Story 5.4 NON-consuming; never deleted, reclaimed at process exit). */
  const overrides = new Map<
    string,
    { file: string; args?: string[]; cwd: string; env?: Record<string, string> }
  >()

  function launch(req: LaunchRequest): LaunchOutcome {
    const terminalId = newTerminalId()
    // Register the spawn override main reads on terminal:open (the renderer opens the
    // EmbeddedTerminal against this terminalId, which triggers terminal:open in main; main reads
    // peekSpawnOverride to spawn `claude` in the picked cwd instead of the default shell).
    overrides.set(terminalId, {
      file: options.spawn.file,
      ...(options.spawn.args !== undefined ? { args: options.spawn.args } : {}),
      cwd: req.cwd,
      ...(options.spawn.env !== undefined ? { env: options.spawn.env } : {})
    })
    launches.set(terminalId, { terminalId, launchedAt: now(), correlatedId: null })
    return { terminalId }
  }

  function peekSpawnOverride(
    terminalId: string
  ): { file: string; args?: string[]; cwd: string; env?: Record<string, string> } | null {
    // NON-CONSUMING (Story 5.4): do NOT delete on read. The override is the durable spawn-recipe
    // for this launch terminalId — it must survive EVERY terminal:open so a StrictMode dev
    // double-mount's surviving open AND a Reopen both re-spawn `claude` (not the default `$SHELL`).
    // A consume-once read was the latent Reopen bug + half of the dev blank-terminal bug.
    return overrides.get(terminalId) ?? null
  }

  /** Resolve the app-spawned claude `Tgid` for a launch from its shell leader pid. Returns null
   *  when claude is not resolvable YET (the t0 window) or on any fail-closed `/proc` miss — the
   *  caller skips the join this tick and retries on the next delta. NEVER throws; never logs the
   *  value (only a code=). */
  function resolveAppClaudeTgid(terminalId: string): number | null {
    const shellPid = options.terminalManager.pidOf(terminalId)
    if (shellPid === null) return null // terminal gone / pid unknown — fail closed, retry later
    let claudePid: number | typeof CLAUDE_NOT_RESOLVED
    try {
      claudePid = resolveClaudeDescendant(shellPid, options.listChildren, options.readComm)
    } catch {
      // resolveClaudeDescendant is fail-closed by design, but belt-and-suspenders: a reader that
      // throws unexpectedly must never escape the per-delta correlation. Code only — never the value.
      log('[c9watch][launch] code=descendant_resolve_failed')
      return null
    }
    if (claudePid === CLAUDE_NOT_RESOLVED) return null // claude not spawned/scanned yet (t0 gap)
    try {
      return resolveTgid(claudePid, options.readStatus)
    } catch {
      // The claude child vanished/denied/malformed between resolve + Tgid read — fail closed.
      log('[c9watch][launch] code=app_tgid_resolve_failed')
      return null
    }
  }

  function correlateAgainst(sessions: Iterable<Session>): void {
    // Linux-only: /proc is Linux. On a non-Linux host the launch still works (the terminal is
    // typeable); only the Tgid join is skipped (the launched-set stays empty — accepted).
    if (platform !== 'linux') return

    // Snapshot the not-yet-correlated launches up front (the map may mutate as we add ids).
    const pending: PendingLaunch[] = []
    for (const l of launches.values()) {
      if (l.correlatedId === null) pending.push(l)
    }
    if (pending.length === 0) return

    // Materialize the sessions once (we iterate them per pending launch). Cheap — it is the
    // reducer's already-parsed Session map (parse-once boundary; we never re-parse c9watch JSON).
    const sessionList = [...sessions]
    if (sessionList.length === 0) return

    for (const launch of pending) {
      // Re-resolve the app claude Tgid EVERY tick — the reported pid wanders; never cache it as
      // identity (oq-6 caveat #2). Null ⇒ not resolvable yet ⇒ retry next delta (optimistic card).
      const appClaudeTgid = resolveAppClaudeTgid(launch.terminalId)
      if (appClaudeTgid === null) continue
      for (const session of sessionList) {
        // Skip sessions already claimed by ANOTHER landed launch (one session ↔ one launch).
        if (options.launchedSet.has(session.id)) continue
        let result: { id: string; matched: boolean }
        try {
          result = correlate(appClaudeTgid, session, options.readStatus)
        } catch {
          // correlate is fail-closed (it catches resolveTgid throws), but never let an
          // unexpected throw escape the per-session loop — one bad session ≠ board down.
          log('[c9watch][launch] code=correlate_failed')
          continue
        }
        if (result.matched) {
          // THE JOIN LANDED — record the session id in the launched-set (NOT at spawn; here). The
          // id is the stable UUID (an opaque, safe-to-keep value). Mark the launch correlated so
          // we stop re-joining it. [F5 — populate on join]
          launch.correlatedId = result.id
          options.launchedSet.add(result.id)
          // Story 3.4 (FR-16) — surface the terminalId ↔ sessionId binding to the renderer ONCE,
          // here at the join-landing site (the only place main holds BOTH ids). Wrapped fail-closed:
          // a throwing callback (e.g. a destroyed window) must never escape the per-delta loop —
          // one bad send ≠ board down. Both values are safe-to-keep (opaque terminalId + the stable
          // UUID session id); the consumer validates AT SOURCE before send (main→renderer delta).
          if (options.onCorrelated !== undefined) {
            try {
              options.onCorrelated({ terminalId: launch.terminalId, sessionId: result.id })
            } catch {
              log('[c9watch][launch] code=on_correlated_failed')
            }
          }
          break // this launch is joined; move to the next pending launch
        }
      }
    }
  }

  function isPending(terminalId: string): boolean {
    const l = launches.get(terminalId)
    return l !== undefined && l.correlatedId === null
  }

  function forget(terminalId: string): void {
    // Story 5.4 — drop ONLY the correlation tracking. The spawn-override is the DURABLE
    // spawn-recipe and is deliberately KEPT so a Reopen after a natural `claude` exit re-spawns
    // claude (not the default `$SHELL`). forget() is called when claude exits FOR REAL (the
    // terminalManager onExit, index.ts) to stop re-correlating a dead launch; it is NOT called on
    // the incidental unmount-stop (a StrictMode dev transient — see CH.terminalStop), so that
    // surviving mount keeps both its correlation tracking and its recipe. The `overrides` map is
    // bounded by the number of launches in a session and is reclaimed at process exit.
    launches.delete(terminalId)
  }

  return { launch, peekSpawnOverride, correlateAgainst, isPending, forget }
}
