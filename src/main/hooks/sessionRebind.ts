// Mid-run session-id change — keep the card, then adopt the new id.
//
// THE PROBLEM (observed 2026-08-05, claude 2.1.222): a claude process the app spawned as
// `claude --session-id <A>` can switch to a NEW session id <B> while the SAME process keeps
// running (a `/clear` and friends — the transcript file changes, the pty does not). Two
// things then went wrong:
//   1. the id switch fires a `SessionEnd` hook for <A>. `hookStatus` maps that to
//      `{ kind: 'removed' }`, so the reducer DELETED the card — while the pty was healthy.
//      The renderer then saw a launched terminal with no card and put it back in the
//      "Starting" group (boardStore `selectStartingTerminals`).
//   2. every later hook carries <B>, which the reducer never learned → `hook_unknown_id`
//      → dropped. Even a surviving card would have frozen at its last status.
//
// THE FIX, in two halves (both live here as injectable, Electron-free decisions; index.ts
// wires them into `onHookEvent`, mirroring how launchRemoval.ts is wired):
//
//   PART 1 — `sessionEndKeepsCard`. CLAUDE.md already declares removal STOP/EXIT-driven and
//   the SessionEnd hook merely "belt-and-suspenders". So a SessionEnd for a session whose pty
//   is STILL ALIVE is not a removal at all — it is an id change. Keep the card and remember
//   the terminal as an ORPHAN (a live launched pty whose bound session id went quiet).
//
//   PART 2 — `OrphanRegistry.claim`. When an UNKNOWN id posts a status hook, it may be the
//   same pty under its new id. Adopt the orphan's card ONLY under a proof narrow enough to
//   keep the Story-3.3 ship gate intact (external sessions must NEVER reach the board):
//     - the hook's `cwd` matches the orphan's cwd EXACTLY (blank cwd never matches), AND
//     - EXACTLY ONE orphan matches (an ambiguous match adopts nothing), AND
//     - that orphan's pty is still alive, AND
//     - the orphan was marked within `REBIND_WINDOW_MS`.
//   A manually-run `claude` in the same cwd during that window is the one false-positive the
//   heuristic admits; the single-match rule plus the window keep it narrow. Widening any of
//   the four conditions re-opens the ship gate — don't.
//
//   PART 2b — `claimByProcess`, the EXACT proof, tried BEFORE the heuristic (2026-09-01).
//   Claude 2.1.257 records each live process's CURRENT session id in
//   `~/.claude/sessions/<pid>.json` (pty/claudeSessionFile.ts). So when an unknown id posts,
//   ask each live launched terminal's process tree what id it now runs: a match IS the same
//   pty under its new id — no cwd, no window, no orphan record needed. That last point is
//   the fix for the freeze the heuristic could not survive: after a `/clear` the new id's
//   first accepted hook can come long after `REBIND_WINDOW_MS` (observed: 24 quiet minutes),
//   and the card then sat on its old id and status for hours. The heuristic stays as the
//   fallback for a claude that keeps no such record; when only its window refuses, it says
//   so (`onWindowRefusal`) so the freeze is at least diagnosable from the log.
//
// NEVER LOG cwd (it leaks the filesystem layout) or any hook field — codes only.
// [.claude/rules/zod-boundaries.md; .claude/rules/state.md; CLAUDE.md "Removal is stop/exit-driven"]

/** A live app-launched pty whose bound session id stopped being the one claude reports. */
export interface OrphanedLaunch {
  /** The app's terminal id — the thing that actually survived the id change. */
  terminalId: string
  /** The session id the card is CURRENTLY keyed by (the one SessionEnd named). */
  sessionId: string
  /** The launch cwd, as reported by the SessionEnd hook. Blank means "unusable" (never matches). */
  cwd: string
  /** Epoch millis the orphan was recorded (injected clock at the call site). */
  orphanedAt: number
}

/** How long after an ignored SessionEnd a new id may still adopt the orphan's card.
 *  Sized from the observed gap: the incident's new id first posted a hook ~20s after the
 *  switch, so a few seconds is too tight. Long enough to cover a slow first turn, short
 *  enough that an unrelated manual `claude` in the same cwd rarely lands inside it. */
export const REBIND_WINDOW_MS = 5 * 60_000

/** The minimal launch-service surface Part 1 needs (structurally satisfied by `LaunchService`
 *  once `terminalIdFor` is added — see launchSession.ts). */
export interface RebindBindingSource {
  /** Reverse of `sessionIdFor`: which terminal is bound to this session id, if any. */
  terminalIdFor(sessionId: string): string | null
}

/** The minimal terminal-manager surface both parts need (satisfied by `TerminalManager.has`). */
export interface LiveTerminals {
  has(terminalId: string): boolean
}

/**
 * PART 1 — decide whether a `SessionEnd` must be IGNORED because the pty is still alive.
 *
 * Returns the terminalId whose card must be kept (the caller marks it as an orphan and skips
 * the removal), or `null` when the SessionEnd is a genuine removal and should be applied as
 * before (no binding, or the pty really is gone).
 *
 * Pure: no I/O, no logging, no clock.
 */
export function sessionEndKeepsCard(
  sessionId: string,
  launch: RebindBindingSource,
  live: LiveTerminals
): string | null {
  const terminalId = launch.terminalIdFor(sessionId)
  if (terminalId === null) return null // not an app launch (or its binding was already consumed)
  return live.has(terminalId) ? terminalId : null
}

/** The orphan registry surface. Keyed by terminalId — one live pty has at most one orphan
 *  record, and a repeat mark for the same terminal REPLACES it (the newest id change wins). */
export interface OrphanRegistry {
  /** Record (or refresh) an orphan. A blank `cwd` is still recorded — it just can never be
   *  claimed — so the entry's presence stays an accurate picture of what went quiet. */
  mark(orphan: OrphanedLaunch): void
  /**
   * PART 2 — the adoption decision. Returns the ONE orphan a hook from `cwd` may adopt, or
   * `null`. See the four conditions in the module header; all must hold.
   */
  claim(cwd: string, now: number, live: LiveTerminals): OrphanedLaunch | null
  /** Drop a terminal's orphan record (adopted, or the terminal died). Idempotent. */
  clear(terminalId: string): void
  /** Current record count (diagnostics / tests). */
  size(): number
}

/**
 * Build an orphan registry. `windowMs` is injectable so tests pin the boundary without a
 * fake clock; the caller passes `now` into `claim` (same inject-now() discipline as the
 * reducer and the board store).
 */
export interface OrphanRegistryOptions {
  /** Adoption window override (tests). Default `REBIND_WINDOW_MS`. */
  windowMs?: number
  /** Called when a live, cwd-matching orphan was refused by the WINDOW ALONE — the one
   *  refusal that leaves a healthy terminal with a frozen card. Diagnostics only; the caller
   *  logs a code (never the cwd). */
  onWindowRefusal?: (terminalId: string) => void
}

export function createOrphanRegistry(options: OrphanRegistryOptions = {}): OrphanRegistry {
  const windowMs = options.windowMs ?? REBIND_WINDOW_MS
  const onWindowRefusal = options.onWindowRefusal
  const orphans = new Map<string, OrphanedLaunch>()

  return {
    mark(orphan: OrphanedLaunch): void {
      orphans.set(orphan.terminalId, orphan)
    },

    claim(cwd: string, now: number, live: LiveTerminals): OrphanedLaunch | null {
      // A blank cwd carries no proof at all — fail closed rather than match everything.
      if (cwd.length === 0) return null

      const matches: OrphanedLaunch[] = []
      for (const orphan of orphans.values()) {
        if (orphan.cwd.length === 0 || orphan.cwd !== cwd) continue
        // A dead pty's card was already removed by the stop/exit path — never adopt it.
        if (!live.has(orphan.terminalId)) continue
        if (now - orphan.orphanedAt > windowMs) {
          onWindowRefusal?.(orphan.terminalId) // everything else matched — only time said no
          continue
        }
        matches.push(orphan)
        // Two candidates are already ambiguous; stop early and adopt nothing.
        if (matches.length > 1) return null
      }
      return matches[0] ?? null
    },

    clear(terminalId: string): void {
      orphans.delete(terminalId)
    },

    size(): number {
      return orphans.size
    }
  }
}

/** One live launched terminal and the session id its card is CURRENTLY keyed by
 *  (`LaunchService.bindings()`). */
export interface LaunchBinding {
  terminalId: string
  sessionId: string
}

/** The minimal terminal-manager surface Part 2b needs (satisfied by `TerminalManager.pidOf`):
 *  the PTY leader pid of a live terminal, or null once it is gone. */
export interface LaunchPids {
  pidOf(terminalId: string): number | null
}

/** Claude's own per-process records (satisfied by `ProcessSessionSource`,
 *  pty/claudeSessionFile.ts): the session ids recorded for the processes under a PTY leader. */
export interface ProcessSessionRecords {
  currentSessionIdsUnder(leaderPid: number): readonly string[]
}

/**
 * PART 2b — the EXACT adoption proof. Returns the live launched terminal whose process tree
 * claude now records as running `newSessionId` (with the id its card is currently keyed by,
 * so the caller can re-key it), or `null` when no launched process claims that id — which is
 * what an external session looks like, so the Story-3.3 ship gate holds.
 *
 * A terminal ALREADY bound to `newSessionId` is never a match: re-keying a card onto its own
 * id would create it and then delete it. A dead pty is skipped without consulting the records
 * (its card is removed by the stop/exit path).
 *
 * Pure: no I/O, no logging, no clock — the records source does the reading.
 */
export function claimByProcess(
  newSessionId: string,
  launches: Iterable<LaunchBinding>,
  pids: LaunchPids,
  records: ProcessSessionRecords
): LaunchBinding | null {
  for (const launch of launches) {
    if (launch.sessionId === newSessionId) continue
    const leaderPid = pids.pidOf(launch.terminalId)
    if (leaderPid === null) continue
    if (records.currentSessionIdsUnder(leaderPid).includes(newSessionId)) {
      return { terminalId: launch.terminalId, sessionId: launch.sessionId }
    }
  }
  return null
}
