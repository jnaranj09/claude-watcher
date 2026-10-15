// The `/proc` status readers and the ancestry check the process-tree code uses.
//
// `readStatusFromProc` is the production `ReadStatus` seam. `claudeSessionFile.ts` uses it with
// `isAncestorOf` + `parseStatusField` to prove which claude process belongs to a terminal.
//
// ── ANCESTRY ─────────────────────────────────────────────────────────────────
// `isAncestorOf(leaderPid, pid)` walks `PPid` UP from `pid`, so it is shape-agnostic: claude as
// the PTY leader, as a child, or as a deep descendant (`claude → npm exec claude →
// MainThread`). Sessions are keyed by their stable `id`, never by `pid`.
//
// ── DESIGN: DI SEAMS ─────────────────────────────────────────────────────────
// Every impure read (`/proc`) is an INJECTED reader so the logic is unit-testable on synthetic
// fixtures with no live processes, and the real `/proc` read is covered by a Linux-only describe
// in pidCorrelation.test.ts.
//
// ── FAIL-CLOSED + NEVER-LOG-PARSED-VALUE (Critical Guardrails #3, #4) ─────────
// Every `/proc` miss (missing field, vanished pid, denied read) returns an "unresolved" result,
// never a wrong silent number and never a crash. We NEVER echo the raw `/proc` blob (it can
// carry cmdline/env/secrets).

import { readFileSync } from 'node:fs'

// ── DI SEAM TYPES ────────────────────────────────────────────────────────────

/** Read the raw text of `/proc/<pid>/status`. Throws if the pid is gone/denied
 *  (the process-gone race) — callers treat a throw as "unresolved", fail closed. */
export type ReadStatus = (pid: number) => string

// ── CORE PARSERS (PURE — fed by the seams) ───────────────────────────────────

/**
 * Parse a single `Field:\tVALUE` line out of a `/proc/<pid>/status` blob.
 * Returns the trimmed VALUE, or `undefined` if the field is absent. NEVER echoes
 * the blob anywhere (no logging here). `noUncheckedIndexedAccess`-safe.
 */
export function parseStatusField(statusBlob: string, field: string): string | undefined {
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
 *  or `undefined` if the field is absent/malformed (digits-only).
 *  NEVER echoes the blob. */
function parsePpid(statusBlob: string): number | undefined {
  const raw = parseStatusField(statusBlob, 'PPid')
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const ppid = Number.parseInt(raw, 10)
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : undefined
}

// ── REAL `/proc` READER SEAM (Linux-only; pidCorrelation.test.ts reads it) ────
//
// The production `ReadStatus` impl. `claudeSessionFile.ts` takes it, and
// pidCorrelation.test.ts drives it against the real kernel. Linux-only (`/proc` is Linux); callers gate on
// `process.platform === 'linux'`. node:fs is a core module, statically imported at
// the top — safe in the main process and the node test env.

/** Real `/proc/<pid>/status` reader (the production `ReadStatus` seam). Throws if
 *  the pid is gone/denied — the fail-closed signal `isAncestorOf` expects. */
export const readStatusFromProc: ReadStatus = (pid: number): string => {
  return readFileSync(`/proc/${pid}/status`, 'utf8')
}
