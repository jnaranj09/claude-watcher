// Story 0.4 — the OQ-6 pid-correlation probe artifact (the validated helper).
//
// ⚠ SPIKE ARTIFACT — NOT WIRED INTO THE LIVE APP. This is the Epic-3 destination
// file (`src/main/pty/pidCorrelation.ts`, per architecture.md#Directory Structure),
// authored HERE as the validated probe output. It is NOT imported by any IPC
// handler, manager, or window in this story. Epic 3's terminal manager adopts it.
//
// ── WHAT OQ-6 IS ─────────────────────────────────────────────────────────────
// c9watch reports a session `pid` that is a WANDERING claude *thread* id — it
// changes between scans for the SAME stable session `id` (UUID). A naive
// `spawnedPid === reportedPid` join therefore FAILS. The deterministic fix
// (proven live this session — see oq-6-pid-correlation-finding.md):
//
//   - KEY sessions by the stable `id` (UUID), NEVER by `pid`.
//   - CORRELATE by computing the thread-group id (`Tgid`) from
//     `/proc/<reported-pid>/status` and matching it to the app-resolved claude
//     process TGID. `Tgid` is the stable, kernel-guaranteed process id behind any
//     wandering thread id of that process.
//
// The app-spawned side: node-pty gives you the PANE/SHELL leader pid (the
// smoke's `ptyPid`), not claude. The c9watch-tracked session is SOME process in
// that PTY's subtree.
//
// ── STORY 5.5 — SUBTREE-ANCESTRY MATCH (the live correlation) ─────────────────
// The original oq-6 walk assumed the tracked claude is an IMMEDIATE child named
// `claude` of the shell. claude 2.1.186 launched via the app breaks that: the
// `bash -l -c claude` login shell EXECS the native `claude` ELF (so the PTY leader
// IS claude), and the c9watch-tracked session runs DEEPER (`claude → npm exec
// claude → MainThread`, comm != `claude`). So the live correlation now matches a
// session to a launched terminal iff the session's process (its Tgid) is a
// DESCENDANT of the terminal's PTY leader pid — `isAncestorOf(leaderPid,
// sessionTgid)`, walking `PPid` UP. Shape-agnostic + 1:1. The old
// `resolveClaudeDescendant` (immediate-child walk) is RETAINED but unwired.
//
// ── DESIGN: DI SEAMS (architecture.md#Testing & Test Seams) ──────────────────
// Every impure read (`/proc`, `pgrep`) is an INJECTED reader so the logic is
// unit-testable on synthetic fixtures with no live processes, and the ONE real
// `/proc` read lives in a single integration test. Mirrors the project's
// `ptyFactory.createPty(): IPtyLike` / `feed.ts(spawnFn)` seam pattern.
//
// ── FAIL-CLOSED + NEVER-LOG-PARSED-VALUE (Critical Guardrails #3, #4) ─────────
// Every `/proc` miss (missing `Tgid:`, vanished pid, denied read, no claude
// child yet) returns an "unresolved/unmatched" sentinel — NEVER a wrong silent
// number, NEVER a crash. We NEVER echo the raw `/proc` blob (it can carry
// cmdline/env/secrets); helpers surface only field path + a typed error.
// [Source: epics.md#Story 0.4; #Verified Facts; architecture.md#Process Patterns;
//  src/shared/schemas/session.ts:62,65; .claude/rules/zod-boundaries.md]

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Session } from '../../shared/schemas/session'

// ── DI SEAM TYPES ────────────────────────────────────────────────────────────

/** Read the raw text of `/proc/<pid>/status`. Throws if the pid is gone/denied
 *  (the process-gone race) — callers treat a throw as "unresolved", fail closed. */
export type ReadStatus = (pid: number) => string

/** Read `comm` (the process name) for a pid — typically `/proc/<pid>/comm` or the
 *  `Name:` line of status. Throws if gone/denied. */
export type ReadComm = (pid: number) => string

/** List the child pids of a shell pid (the node-pty pane leader). The real impl
 *  reads `/proc/<shellPid>/task/<tid>/children` (preferred) or shells out to
 *  `pgrep -P <shellPid>`. Returns [] when there are no children (the OQ-6 timing
 *  gap: claude not spawned/scanned yet). MUST NOT throw for "no children". */
export type ListChildren = (shellPid: number) => readonly number[]

// ── SENTINEL / ERRORS ────────────────────────────────────────────────────────

/** Returned by descendant resolution when no `claude` child is resolvable YET —
 *  the OQ-6 *timing* gap (UX-DR19: a freshly launched session may appear before
 *  its claude pid is joined). This is NOT an error: the caller shows the card
 *  pid-pending and reconciles when the join lands. Distinct from a wrong pid. */
export const CLAUDE_NOT_RESOLVED = null
export type ClaudeDescendant = number | typeof CLAUDE_NOT_RESOLVED

/** Thrown when `/proc/<pid>/status` is present but malformed (no parseable
 *  `Tgid:` line). Carries the pid (a number, safe) + the field we failed to find
 *  — NEVER the raw blob (Guardrail #4). The caller fails closed on this. */
export class TgidParseError extends Error {
  readonly pid: number
  readonly field: string
  constructor(pid: number, field: string) {
    super(`could not parse ${field} from /proc/${pid}/status`)
    this.name = 'TgidParseError'
    this.pid = pid
    this.field = field
  }
}

// ── CORE PARSERS (PURE — fed by the seams) ───────────────────────────────────

/**
 * Parse a single `Field:\tVALUE` line out of a `/proc/<pid>/status` blob.
 * Returns the trimmed VALUE, or `undefined` if the field is absent. NEVER echoes
 * the blob anywhere (no logging here). `noUncheckedIndexedAccess`-safe.
 */
function parseStatusField(statusBlob: string, field: string): string | undefined {
  // `/proc/<pid>/status` lines are `Field:` + whitespace + value. Match at line
  // start to avoid a field name appearing inside another field's value.
  const lines = statusBlob.split('\n')
  const prefix = `${field}:`
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim()
    }
  }
  return undefined
}

/**
 * Resolve the stable claude *process* id (Tgid) from a reported (possibly
 * wandering thread) pid — THE AC-1 mechanism.
 *
 * Reads `/proc/<reportedPid>/status` via the injected `readStatus` seam and
 * returns its `Tgid:` value:
 *   - thread of a process     → `Tgid != Pid`  → returns the process leader.
 *   - the group leader itself → `Tgid == Pid`  → returns it unchanged.
 *
 * FAIL CLOSED:
 *   - reportedPid gone/denied (readStatus throws)   → re-throws (caller catches → unmatched).
 *   - status present but no parseable `Tgid:`        → throws TgidParseError.
 * It NEVER returns a wrong silent number and NEVER logs the blob.
 *
 * [Live evidence: reported pids 664822 & 664819 (`Name: HeapHelper`) both →
 *  `Tgid: 664817` = the real `claude` process. See oq-6 finding.]
 */
export function resolveTgid(reportedPid: number, readStatus: ReadStatus): number {
  // readStatus throws on a vanished/denied pid — let it propagate; the caller
  // (correlate) treats a throw as "process gone → unmatched", failing closed.
  const blob = readStatus(reportedPid)
  const raw = parseStatusField(blob, 'Tgid')
  if (raw === undefined) {
    throw new TgidParseError(reportedPid, 'Tgid')
  }
  // STRICT digits-only match BEFORE parseInt — fail closed on integer-plus-garbage.
  // `Number.parseInt('664817 stray', 10)` returns 664817 (it stops at the first
  // non-digit and silently drops the rest), which would PASS a bare
  // `Number.isInteger && > 0` guard and accept a malformed/partially-written
  // `Tgid:` line as valid. A real kernel `/proc/<pid>/status` `Tgid:` value is
  // always pure digits, so anything else is a malformed read → fail closed.
  // (We test `raw`, never echo it — Guardrail #4.)
  if (!/^\d+$/.test(raw)) {
    throw new TgidParseError(reportedPid, 'Tgid')
  }
  const tgid = Number.parseInt(raw, 10)
  if (!Number.isInteger(tgid) || tgid <= 0) {
    // Defensive: a digit-only string above Number.MAX_SAFE_INTEGER would lose
    // precision; reject anything that is not a clean positive integer.
    throw new TgidParseError(reportedPid, 'Tgid')
  }
  return tgid
}

/**
 * Resolve the `claude` DESCENDANT pid from a node-pty shell (pane leader) pid —
 * the AC-2 mechanism. node-pty hands you the shell leader, NOT claude; claude is
 * a child of that shell (`claude → bash → …` live ancestry).
 *
 * ⚠ SUPERSEDED (Story 5.5) — NO LONGER WIRED into the live correlation. It assumed
 * the tracked claude is an IMMEDIATE child named `claude` of the pane shell. claude
 * 2.1.186 launched via the app does NOT have that shape: the `bash -l -c claude`
 * login shell EXECS into the native `claude` ELF (so the PTY leader IS claude), and
 * the c9watch-TRACKED session runs as a DEEP descendant (`claude → npm exec claude →
 * MainThread`, comm != `claude`). So this immediate-child-named-`claude` walk returns
 * CLAUDE_NOT_RESOLVED forever for an app launch. The live correlation now matches by
 * SUBTREE ANCESTRY instead (see `isAncestorOf` / `correlate`). This function + its
 * readers are RETAINED as a tested utility + the oq-6 record. [Source: Story 5.5]
 *
 * Lists the shell's children via the injected `listChildren` seam (the real impl
 * reads `/proc/<shell>/task/*\/children`, falling back to `pgrep -P`), then
 * VALIDATES each child's `comm`/`Name` is exactly `claude` before returning it —
 * so we never match the pane shell (`bash`) itself (the classic OQ-6 trap).
 *
 * FAIL CLOSED / TIMING:
 *   - no children, or no child whose `comm == 'claude'` yet → CLAUDE_NOT_RESOLVED
 *     (the UX-DR19 pid-pending timing gap — NOT a wrong pid, NOT a crash).
 *   - a child whose `comm` read throws (vanished between list & read) is SKIPPED.
 *
 * [Live evidence: shell bash(189223) → /proc/189223/task/189223/children = 664817;
 *  comm(664817) == 'claude'. pgrep -P 189223 also yields 664817 (comm=claude).]
 */
export function resolveClaudeDescendant(
  shellPid: number,
  listChildren: ListChildren,
  readComm: ReadComm
): ClaudeDescendant {
  const children = listChildren(shellPid)
  for (const child of children) {
    let comm: string
    try {
      comm = readComm(child).trim()
    } catch {
      // Child vanished between the list and the comm read (race) — skip it, keep
      // scanning the rest. Never echo anything about the child beyond skipping.
      continue
    }
    if (comm === 'claude') {
      return child
    }
  }
  // Either no children yet (claude not spawned) or only the pane shell so far:
  // the timing gap. Reconcile on a later scan — never return a wrong pid.
  return CLAUDE_NOT_RESOLVED
}

/** Bound the ancestry walk so a degenerate/looping `/proc` chain can never spin.
 *  A real process tree is at most a few dozen deep; 128 is a generous fail-closed cap. */
const MAX_ANCESTRY_DEPTH = 128

/**
 * THE ANCESTRY PRIMITIVE (Story 5.5): is `ancestorPid` an ancestor of (or equal to)
 * `descendantPid`? Walks the `PPid` chain UP from `descendantPid` via the injected
 * `readStatus` seam; returns true the moment it reaches `ancestorPid`.
 *
 * This is the correlation that WORKS for claude 2.1.186's actual process shape: the
 * app owns a PTY whose leader pid is `ancestorPid`; the c9watch-tracked session is
 * SOME descendant of it (`claude → npm exec claude → MainThread`), regardless of name
 * or depth. It is shape-agnostic (claude as leader, child, or deep descendant) and 1:1
 * (each PTY leader owns a disjoint subtree).
 *
 * FAIL CLOSED:
 *   - a pid in the chain is gone/denied (readStatus throws)  → false (not under).
 *   - a malformed/absent `PPid:`                              → false.
 *   - reaching pid ≤ 1 (init) without hitting ancestorPid     → false.
 *   - a self-parent loop or depth > MAX_ANCESTRY_DEPTH        → false.
 * It NEVER throws and NEVER logs the `/proc` blob (Guardrail #4).
 *
 * [Source: Story 5.5; live tree `463321 → 463125 → 462856` (session → npm exec claude
 *  → PTY leader); c9watch's own `self` ownership model is PID ancestry.]
 */
export function isAncestorOf(
  ancestorPid: number,
  descendantPid: number,
  readStatus: ReadStatus
): boolean {
  let pid = descendantPid
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth++) {
    if (pid === ancestorPid) return true // reached the PTY leader (or started AT it)
    if (pid <= 1) return false // hit init/kthreadd without crossing the leader — not under it
    let ppid: number | undefined
    try {
      ppid = parsePpid(readStatus(pid))
    } catch {
      return false // process gone/denied between scans — fail closed
    }
    if (ppid === undefined || ppid === pid) return false // malformed or self-loop — fail closed
    pid = ppid
  }
  return false // degenerate depth — fail closed
}

/** Parse the `PPid:` value out of a `/proc/<pid>/status` blob. Returns the parent pid,
 *  or `undefined` if the field is absent/malformed (same digits-only discipline as Tgid).
 *  NEVER echoes the blob. */
function parsePpid(statusBlob: string): number | undefined {
  const raw = parseStatusField(statusBlob, 'PPid')
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const ppid = Number.parseInt(raw, 10)
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : undefined
}

/** The correlation result: the stable session `id` (identity) + whether the session's
 *  process belongs to (descends from) the launched terminal's PTY. We key the result on
 *  `id`, NEVER on a pid. */
export interface CorrelationResult {
  /** The stable session identity (UUID) — the key, never the pid. */
  readonly id: string
  /** True iff the session's process (its Tgid) is a descendant of the launched
   *  terminal's PTY leader (subtree-ancestry match — Story 5.5). */
  readonly matched: boolean
}

/**
 * THE JOIN (Story 5.5): correlate a c9watch session to an app-launched terminal by
 * SUBTREE ANCESTRY, keyed on the stable `id`.
 *
 * Resolves the session's stable process id (`resolveTgid(session.pid)` — the reported
 * pid is a wandering thread id), then asks whether that process is a DESCENDANT of the
 * launched terminal's PTY leader (`ptyLeaderPid` = node-pty's pane-leader pid). The
 * terminal "owns" every process in its PTY subtree, so the session it spawned matches —
 * regardless of how deep claude nests its tracked session (`claude → npm exec claude →
 * MainThread`) or what that process is named.
 *
 * This REPLACES the pre-5.5 `sessionTgid === appClaudeTgid` equality (which assumed the
 * tracked session IS the immediate `claude` child — false for claude 2.1.186). It still
 * NEVER does `spawnedPid === session.pid` (the OQ-6 wandering-pid trap).
 *
 * FAIL CLOSED: if the session's reported pid is gone/denied/malformed, `resolveTgid`
 * throws → caught → `{ id, matched: false }`. The ancestry walk is itself fail-closed
 * (a gone pid in the chain → not-a-match). No crash, no wrong match; the id (an opaque
 * UUID) is always preserved so the caller keeps the card pid-pending.
 *
 * [Source: Story 5.5; src/shared/schemas/session.ts:62,65 (id=identity, pid=non-identity);
 *  UX-DR19 (reconcile when the join lands); live tree session→…→PTY-leader ancestry.]
 */
export function correlate(
  ptyLeaderPid: number,
  session: Pick<Session, 'id' | 'pid'>,
  readStatus: ReadStatus
): CorrelationResult {
  let sessionTgid: number
  try {
    sessionTgid = resolveTgid(session.pid, readStatus)
  } catch {
    // Process-gone race, denied read, or malformed status → fail closed.
    // We do NOT log the raw blob; the id is an opaque UUID, safe to keep.
    return { id: session.id, matched: false }
  }
  return { id: session.id, matched: isAncestorOf(ptyLeaderPid, sessionTgid, readStatus) }
}

// ── REAL `/proc` READER SEAMS (Linux-only; the integration test injects these) ─
//
// These are the production reader impls Epic-3 adopts. They are exported so the
// ONE `/proc` integration test can drive them against the real kernel, and so
// Epic-3's manager can inject them. They are NOT invoked anywhere in this story's
// runtime (no IPC/main wiring). Linux-only (`/proc` is Linux); callers gate on
// `process.platform === 'linux'`. node:fs/child_process are core modules,
// statically imported at the top — safe in the main process and the node test env.

/** Real `/proc/<pid>/status` reader (the production `ReadStatus` seam). Throws if
 *  the pid is gone/denied — exactly the fail-closed signal `correlate` expects. */
export const readStatusFromProc: ReadStatus = (pid: number): string => {
  return readFileSync(`/proc/${pid}/status`, 'utf8')
}

/** Real `comm` reader (the production `ReadComm` seam): `/proc/<pid>/comm` is the
 *  process name (truncated to 15 chars by the kernel, but `claude` fits). */
export const readCommFromProc: ReadComm = (pid: number): string => {
  return readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
}

/**
 * Real child-list reader (the production `ListChildren` seam): reads
 * `/proc/<shellPid>/task/<tid>/children` for every thread of the shell and
 * unions the pids. This is the PREFERRED path (no extra binary; needs
 * CONFIG_PROC_CHILDREN, present on Fedora). Returns [] (not throw) when the shell
 * has no children or the dirs are unreadable — the timing gap, fail closed.
 */
export const listChildrenFromProc: ListChildren = (shellPid: number): readonly number[] => {
  const pids = new Set<number>()
  let tids: string[]
  try {
    tids = readdirSync(`/proc/${shellPid}/task`)
  } catch {
    return [] // shell gone or denied → no children resolvable (fail closed)
  }
  for (const tid of tids) {
    let raw: string
    try {
      raw = readFileSync(`/proc/${shellPid}/task/${tid}/children`, 'utf8')
    } catch {
      continue // this thread's children file vanished/denied — skip
    }
    // The file is space-separated pids (possibly with a trailing space/newline).
    for (const token of raw.split(/\s+/)) {
      if (token.length === 0) continue
      // Digits-only: reject a malformed token (e.g. `664817x`) instead of letting
      // parseInt silently truncate it to a wrong pid — fail closed per token.
      if (!/^\d+$/.test(token)) continue
      const childPid = Number.parseInt(token, 10)
      if (Number.isInteger(childPid) && childPid > 0) {
        pids.add(childPid)
      }
    }
  }
  return [...pids]
}

/**
 * `pgrep -P <shellPid>` fallback child-list reader (the documented AC-2
 * fallback when `task/*\/children` is unavailable). Synchronous, returns [] on
 * any failure (no match → pgrep exits 1; we treat that as "no children").
 */
export const listChildrenFromPgrep: ListChildren = (shellPid: number): readonly number[] => {
  let out: string
  try {
    out = execFileSync('pgrep', ['-P', String(shellPid)], { encoding: 'utf8' })
  } catch {
    // pgrep exits non-zero when there are no children — fail closed to [].
    return []
  }
  const pids = new Set<number>()
  for (const token of out.split(/\s+/)) {
    if (token.length === 0) continue
    // Digits-only (same fail-closed discipline as listChildrenFromProc) + dedup
    // via a Set so both readers return a consistent, garbage-free pid list.
    if (!/^\d+$/.test(token)) continue
    const childPid = Number.parseInt(token, 10)
    if (Number.isInteger(childPid) && childPid > 0) {
      pids.add(childPid)
    }
  }
  return [...pids]
}
