// Claude per-process session records — the injectable source behind the EXACT session-rebind
// proof ("the process under this PTY now runs session B").
//
// WHY THIS EXISTS. When the operator runs `/clear`, claude keeps the same process and pty but
// switches to a NEW session id, and no hook ever states "pid P is now session B". The
// cwd-plus-window heuristic in hooks/sessionRebind.ts guessed it; it froze a card for good
// whenever the new id's first accepted hook came after the 5-minute window (observed
// 2026-09-01: a `/clear`, then 24 quiet minutes, then a session with an armed Monitor sat on
// `idle` for hours while every hook it sent was dropped as `hook_unknown_id`).
//
// Claude 2.1.257 records the answer itself: `~/.claude/sessions/<pid>.json` holds each live
// process's CURRENT `sessionId` (schema: src/shared/schemas/claudeSessionFile.ts). Given a
// launched terminal's PTY leader pid, this module lists that directory and returns the ids
// recorded for every process UNDER the leader — the leader itself (the login shell exec'd the
// claude ELF, so on the current shape they are the same pid) or any descendant (a shell that
// did not exec). The ancestry walk is `pidCorrelation.isAncestorOf`, which needs no /proc read
// at all when the leader IS the recorded pid.
//
// ONLY THE TERMINAL'S OWN CLAUDE IS A PROOF (R18, 2026-09-28). A claude that another claude
// started — its Bash tool running `claude -p` — writes its own record, and it sits under the
// same leader (live tree, claude 2.1.284: claude(leader) → bash → claude -p). Before this, its id
// was returned beside the outer one, so a nested claude that posted a hook could take over the
// card. The terminal's own claude is the OUTERMOST one: a recorded process with no other claude
// between it and the leader (the leader included). "A claude" there means a process with a
// valid record OR a `/proc` `Name:` of `claude` — either marks it, so an outer claude whose own
// record is unreadable still shadows the one it started. An ancestor that cannot be read makes
// the candidate NO proof. Several outermost claudes are returned as they are; the caller
// (`claimByProcess`) refuses an id that more than one of them names.
//
// FAIL CLOSED, DROP QUIETLY, NEVER THROW. A missing directory (older claude), an unreadable or
// malformed file, or a record whose `pid` disagrees with its file name all yield NOTHING — the
// caller then falls back to the heuristic, exactly as if this module did not exist. Only
// `<digits>.json` names are ever opened: the directory also holds `<pid>.<hex>.key` files the
// app has no business reading.
//
// AGENT VIEW — A PARKED TERMINAL (2026-10-06, claude 2.1.291). ← in claude moves the
// conversation into a background job run by claude's daemon, OUTSIDE the pty. The terminal's own
// record keeps its old (stale) `sessionId` and gains `parkedJobId`; the job's record has
// `kind: "bg"`, `jobId` (stable across a `/clear` in the job) and the CURRENT `sessionId` every
// later hook carries. For a parked outermost claude this module returns the job's current id
// INSTEAD of the stale one (returning both would let an agent-list hook under the old id re-key
// the card back). Finding the job means opening records OUTSIDE the tree — only while parked,
// and only `pid`/`sessionId`/`kind`/`jobId` are compared. Zero or several job matches → no id.
// The dir also holds `kind: "daemon"` / `"daemon-worker"` records (claude 2.1.292 enum); the
// `kind === "bg"` filter skips them.
//
// NEVER LOG. The record carries the operator's cwd and session name. No path, no value, no
// error is ever logged here. [.claude/rules/zod-boundaries.md]

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  parseClaudeSessionFile,
  type ClaudeSessionFile
} from '../../shared/schemas/claudeSessionFile'
import {
  isAncestorOf,
  parseStatusField,
  readStatusFromProc,
  type ReadStatus
} from './pidCorrelation'

export interface ProcessSessionSource {
  /** The session id claude currently records for each OUTERMOST claude process under the PTY
   *  leader `leaderPid` (the leader itself, or a descendant with no other claude between it and
   *  the leader). A nested claude's id is never listed (R18). A PARKED outermost claude (agent
   *  view) is listed by its background job's CURRENT id, never its own stale one; no unique job
   *  record → nothing for it. Empty when nothing is recorded, readable, or under the leader. */
  currentSessionIdsUnder(leaderPid: number): readonly string[]
  /** True when an outermost claude under the leader has moved its conversation into a
   *  background job (`parkedJobId`). False on any read failure. */
  parkedUnder(leaderPid: number): boolean
}

export interface ProcessSessionSourceDeps {
  /** The directory of `<pid>.json` records (production: `<claude config dir>/sessions`). */
  sessionsDir: string
  /** List the entry names of a directory (production: `fs.readdirSync`). May throw. */
  listDir: (dir: string) => readonly string[]
  /** Read a file as UTF-8 (production: `fs.readFileSync`). May throw. */
  readFile: (path: string) => string
  /** The `/proc/<pid>/status` seam for the ancestry walk (production: `readStatusFromProc`). */
  readStatus: ReadStatus
}

/** Bound the outermost-claude walk (same cap as `pidCorrelation.isAncestorOf`). */
const MAX_WALK_DEPTH = 128

/** A record file name is exactly `<pid>.json` — nothing else in the directory is ever opened. */
const RECORD_NAME = /^(\d+)\.json$/

export function createProcessSessionSource(deps: ProcessSessionSourceDeps): ProcessSessionSource {
  const { sessionsDir, listDir, readFile, readStatus } = deps

  /** Read and parse one `<pid>.json`; null on any failure or a pid/file-name mismatch. */
  function readRecord(name: string, pid: number): ClaudeSessionFile | null {
    let raw: unknown
    try {
      raw = JSON.parse(readFile(join(sessionsDir, name)))
    } catch {
      return null // unreadable or not JSON — skip this record
    }
    const record = parseClaudeSessionFile(raw)
    return record === null || record.pid !== pid ? null : record // malformed, or stale/copied
  }

  /** Every `<pid>.json` name in the dir, as [name, pid]. Null when the dir cannot be listed. */
  function recordNames(): (readonly [string, number])[] | null {
    let names: readonly string[]
    try {
      names = listDir(sessionsDir)
    } catch {
      return null // no directory (older claude) or unreadable — no proof, no noise
    }
    const out: (readonly [string, number])[] = []
    for (const name of names) {
      const match = RECORD_NAME.exec(name)
      if (match === null) continue
      const pid = Number.parseInt(match[1] ?? '', 10)
      if (Number.isInteger(pid) && pid > 0) out.push([name, pid])
    }
    return out
  }

  /** The OUTERMOST claude records under the leader (R18). */
  function outermostUnder(
    leaderPid: number,
    names: readonly (readonly [string, number])[]
  ): ClaudeSessionFile[] {
    const records = new Map<number, ClaudeSessionFile>() // pid → its record
    for (const [name, pid] of names) {
      // Gate the READ on ancestry: a stranger's record is never even opened.
      if (!isAncestorOf(leaderPid, pid, readStatus)) continue
      const record = readRecord(name, pid)
      if (record !== null) records.set(pid, record)
    }
    const out: ClaudeSessionFile[] = []
    for (const [pid, record] of records) {
      if (isOutermostClaude(pid, leaderPid, records)) out.push(record)
    }
    return out
  }

  /** The CURRENT session id of the ONE background job with this `jobId`; null on zero or
   *  several. Opens records outside the tree — called only for a parked terminal. */
  function parkedJobSessionId(
    jobId: string,
    names: readonly (readonly [string, number])[]
  ): string | null {
    let found: string | null = null
    for (const [name, pid] of names) {
      const record = readRecord(name, pid)
      if (record === null || record.kind !== 'bg' || record.jobId !== jobId) continue
      if (found !== null) return null // two jobs claim the id — ambiguous, no proof
      found = record.sessionId
    }
    return found
  }

  function currentSessionIdsUnder(leaderPid: number): readonly string[] {
    const names = recordNames()
    if (names === null) return []
    const ids: string[] = []
    for (const record of outermostUnder(leaderPid, names)) {
      if (record.parkedJobId === undefined) {
        ids.push(record.sessionId)
        continue
      }
      const jobSessionId = parkedJobSessionId(record.parkedJobId, names)
      if (jobSessionId !== null) ids.push(jobSessionId)
    }
    return ids
  }

  function parkedUnder(leaderPid: number): boolean {
    const names = recordNames()
    if (names === null) return false
    return outermostUnder(leaderPid, names).some((record) => record.parkedJobId !== undefined)
  }

  /** R18: is `pid` the outermost claude under the leader — no claude among its ancestors up to
   *  and including the leader? Fails closed (false) on any unreadable or malformed ancestor.
   *  `pid` is already known to be under the leader, so the walk ends there; the depth cap only
   *  guards a `/proc` that changed under us. */
  function isOutermostClaude(
    pid: number,
    leaderPid: number,
    records: ReadonlyMap<number, unknown>
  ): boolean {
    let current = pid
    for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
      if (current === leaderPid) return true // reached the leader with no claude above
      const parent = parentOf(current)
      if (parent === null) return false
      if (records.has(parent)) return false // a recorded claude above it: nested
      let parentName: string | undefined
      try {
        parentName = parseStatusField(readStatus(parent), 'Name')
      } catch {
        return false
      }
      if (parentName === undefined || parentName === 'claude') return false // nested, or unknown
      current = parent
    }
    return false
  }

  function parentOf(pid: number): number | null {
    let raw: string | undefined
    try {
      raw = parseStatusField(readStatus(pid), 'PPid')
    } catch {
      return null
    }
    if (raw === undefined || !/^\d+$/.test(raw)) return null
    const ppid = Number.parseInt(raw, 10)
    return ppid > 0 && ppid !== pid ? ppid : null
  }

  return { currentSessionIdsUnder, parkedUnder }
}

/** Claude's config directory: its documented `CLAUDE_CONFIG_DIR` override, else `~/.claude`. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['CLAUDE_CONFIG_DIR']
  return override !== undefined && override.length > 0 ? override : join(homedir(), '.claude')
}

/** Where claude records each live process's current session id. */
export function claudeSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), 'sessions')
}

/** The production source over the real fs and /proc. */
export function createProcessSessionSourceFromFs(): ProcessSessionSource {
  return createProcessSessionSource({
    sessionsDir: claudeSessionsDir(),
    listDir: (dir) => readdirSync(dir),
    readFile: (path) => readFileSync(path, 'utf8'),
    readStatus: readStatusFromProc
  })
}
