// Story 0.4 — the OQ-6 pid-correlation probe tests (the validating gate).
//
// Project: `main-unit` (environment: 'node') — matches the `src/main/**/*.test.ts`
// glob in vitest.config.ts. node env is REQUIRED: `/proc` + process semantics are
// node-only, and the ONE integration test reads the real `/proc` (Linux). These
// are NOT jsdom tests.
//
// Two layers, exactly as AC-4 demands:
//   1. PURE UNIT TESTS on SYNTHETIC `/proc`-shaped fixtures via injected reader
//      seams — deterministic, no live processes, no live claude, no c9watch. Every
//      fixture is grounded in the REAL shapes captured 2026-06-18 (see the finding
//      doc): wandering thread `Name: HeapHelper`/`Tgid: 664817`; ancestry bash →
//      claude(664817); two reported pids → one Tgid.
//   2. ONE `/proc` INTEGRATION CHECK against a real, deterministic spawned child
//      (NOT live claude) — proves the `/proc` parsing matches the actual kernel
//      format on this Fedora host. Reaps the child on every path; skips on non-Linux.
//
// [Source: vitest.config.ts (main-unit/node, glob src/main/**/*.test.ts);
//  epics.md#Story 0.4 AC-4; architecture.md#Testing & Test Seams (DI seams,
//  fail-closed named tests); Critical Guardrails #5 (deterministic), #6 (reap).]
import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  resolveTgid,
  isAncestorOf,
  correlate,
  TgidParseError,
  readStatusFromProc,
  type ReadStatus
} from './pidCorrelation'

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC `/proc/<pid>/status` FIXTURES — grounded in the REAL live shapes.
// Real wandering-thread blob: `Name: HeapHelper`, `Pid: 664819`, `Tgid: 664817`.
// Real leader blob:          `Name: claude`,     `Pid: 664817`, `Tgid: 664817`.
// ─────────────────────────────────────────────────────────────────────────────

/** A wandering-thread status blob (Tgid != Pid) — the AC-1 case. Mirrors the
 *  real `/proc/664819/status` head captured live. */
function statusThread(pid: number, tgid: number, name = 'HeapHelper'): string {
  return [
    `Name:\t${name}`,
    'Umask:\t0022',
    'State:\tS (sleeping)',
    `Tgid:\t${tgid}`,
    'Ngid:\t0',
    `Pid:\t${pid}`,
    'PPid:\t189223',
    'TracerPid:\t0',
    ''
  ].join('\n')
}

/** A group-leader status blob (Tgid == Pid) — the degenerate "already the leader"
 *  case. Mirrors the real `/proc/664817/status` (the `claude` process). */
function statusLeader(pid: number, name = 'claude'): string {
  return statusThread(pid, pid, name)
}

/** A status blob with an explicit PPid — for the Story-5.5 ancestry-walk tests
 *  (the walk reads Tgid + PPid). `Pid == Tgid` (a process leader in the chain). */
function statusNode(pid: number, ppid: number, name = 'x'): string {
  return [
    `Name:\t${name}`,
    'State:\tS (sleeping)',
    `Tgid:\t${pid}`,
    `Pid:\t${pid}`,
    `PPid:\t${ppid}`,
    ''
  ].join('\n')
}

/** Build a `ReadStatus` seam from a pid→blob table; a missing pid THROWS (the
 *  process-gone race — exactly what the real readFileSync does on a dead pid). */
function readStatusFrom(table: Readonly<Record<number, string>>): ReadStatus {
  return (pid: number): string => {
    const blob = table[pid]
    if (blob === undefined) {
      throw new Error('ENOENT') // process gone — never echo anything more
    }
    return blob
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveTgid — wandering thread id → stable claude process id (AC-1)', () => {
  it('returns the Tgid for a wandering thread (Tgid != Pid) — the real HeapHelper case', () => {
    // Real live shape: reported pid 664819 (Name: HeapHelper) → Tgid 664817.
    const read = readStatusFrom({ 664819: statusThread(664819, 664817) })
    expect(resolveTgid(664819, read)).toBe(664817)
  })

  it('returns the leader pid unchanged when the reported pid IS the leader (Tgid == Pid)', () => {
    // Degenerate case: reported pid already the process leader (claude 664817).
    const read = readStatusFrom({ 664817: statusLeader(664817) })
    expect(resolveTgid(664817, read)).toBe(664817)
  })

  it('FAILS CLOSED on a status blob with no Tgid line — throws TgidParseError, not a wrong number', () => {
    const malformed = 'Name:\tbroken\nState:\tS (sleeping)\nPid:\t123\n'
    const read = readStatusFrom({ 123: malformed })
    expect(() => resolveTgid(123, read)).toThrow(TgidParseError)
  })

  it('FAILS CLOSED on a non-numeric Tgid value — throws, never coerces to NaN/0', () => {
    const garbage = 'Name:\tx\nTgid:\tnot-a-number\nPid:\t5\n'
    const read = readStatusFrom({ 5: garbage })
    expect(() => resolveTgid(5, read)).toThrow(TgidParseError)
  })

  it('FAILS CLOSED on an integer-plus-garbage Tgid value — never silently truncates via parseInt', () => {
    // The trap: `Number.parseInt('664817 stray', 10)` returns 664817, which would
    // PASS a bare `Number.isInteger && > 0` guard and accept a malformed/partial
    // read as a valid Tgid. The strict digits-only guard must reject it.
    const trailingSpace = 'Name:\tx\nTgid:\t664817 stray\nPid:\t664817\n'
    const trailingAlpha = 'Name:\tx\nTgid:\t664817abc\nPid:\t664817\n'
    expect(() => resolveTgid(1, readStatusFrom({ 1: trailingSpace }))).toThrow(TgidParseError)
    expect(() => resolveTgid(2, readStatusFrom({ 2: trailingAlpha }))).toThrow(TgidParseError)
  })

  it('propagates the reader throw for a vanished pid (process-gone race)', () => {
    const read = readStatusFrom({}) // pid not in table → reader throws
    expect(() => resolveTgid(999999, read)).toThrow()
  })

  it('never echoes the raw /proc blob in the parse error (Guardrail #4)', () => {
    const blobWithSecret = 'Name:\tx\nSECRET=hunter2\nState:\tS\nPid:\t7\n'
    const read = readStatusFrom({ 7: blobWithSecret })
    try {
      resolveTgid(7, read)
      throw new Error('expected resolveTgid to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(TgidParseError)
      expect((e as Error).message).not.toContain('hunter2')
      expect((e as TgidParseError).pid).toBe(7)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('THE LOAD-BEARING TEST — two reported pids → ONE Tgid (AC-1 thesis)', () => {
  it('two DIFFERENT wandering thread pids of the same claude both correlate to ONE id; naive equality would FAIL', () => {
    // Reproduces the live evidence: session 87355f6d reported pid 664822 then
    // 664819 across two scans — BOTH are HeapHelper threads of claude Tgid 664817.
    const SESSION_ID = '87355f6d-07bb-406d-9db8-efe0c1c6ad1f'
    const CLAUDE_TGID = 664817
    const scanA = { id: SESSION_ID, pid: 664822 }
    const scanB = { id: SESSION_ID, pid: 664819 }

    const read = readStatusFrom({
      664822: statusThread(664822, CLAUDE_TGID),
      664819: statusThread(664819, CLAUDE_TGID)
    })

    // The Tgid approach: BOTH wandering pids correlate to the same claude, keyed on id.
    const rA = correlate(CLAUDE_TGID, scanA, read)
    const rB = correlate(CLAUDE_TGID, scanB, read)
    expect(rA).toEqual({ id: SESSION_ID, matched: true })
    expect(rB).toEqual({ id: SESSION_ID, matched: true })

    // The NAIVE approach (spawnedPid === reportedPid) would have FAILED both:
    // the app spawned/resolved claude as 664817, but the reported pids are 664822
    // / 664819 — neither equals 664817. Asserted side-by-side to prove the thesis.
    const naiveA = CLAUDE_TGID === scanA.pid
    const naiveB = CLAUDE_TGID === scanB.pid
    expect(naiveA).toBe(false)
    expect(naiveB).toBe(false)
    // Tgid-right, equality-wrong, for the SAME inputs:
    expect(rA.matched).toBe(true)
    expect(rB.matched).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('isAncestorOf — subtree ancestry walk (Story 5.5)', () => {
  // The live claude 2.1.186 launch chain: PTY leader → npm exec claude → session leader.
  const LEADER = 462856
  const NPM = 463125
  const SESSION = 463321
  const tree = readStatusFrom({
    [SESSION]: statusNode(SESSION, NPM, 'MainThread'),
    [NPM]: statusNode(NPM, LEADER, 'npm exec claude'),
    [LEADER]: statusNode(LEADER, 461573, 'claude')
  })

  it('true when start IS the ancestor (degenerate self — leader is the session)', () => {
    expect(isAncestorOf(LEADER, LEADER, tree)).toBe(true)
  })

  it('true for an immediate child', () => {
    expect(isAncestorOf(LEADER, NPM, tree)).toBe(true)
  })

  it('true for a DEEP descendant — the real `leader → npm exec claude → MainThread` shape', () => {
    // This is the exact case the pre-5.5 immediate-child walk could NOT resolve.
    expect(isAncestorOf(LEADER, SESSION, tree)).toBe(true)
  })

  it('false when the process is NOT under the ancestor (chain reaches init first)', () => {
    // A separate tree whose chain hits PPid 1 without crossing LEADER.
    const other = readStatusFrom({ 990000: statusNode(990000, 1, 'MainThread') })
    expect(isAncestorOf(LEADER, 990000, other)).toBe(false)
  })

  it('FAILS CLOSED when a pid in the chain is gone (reader throws → not under)', () => {
    // SESSION points at NPM, but NPM is absent → the walk cannot reach LEADER → false.
    const broken = readStatusFrom({ [SESSION]: statusNode(SESSION, NPM, 'MainThread') })
    expect(isAncestorOf(LEADER, SESSION, broken)).toBe(false)
  })

  it('FAILS CLOSED on a malformed/absent PPid (never coerces)', () => {
    const noPpid = readStatusFrom({ 7: 'Name:\tx\nTgid:\t7\nPid:\t7\n' }) // no PPid line
    expect(isAncestorOf(LEADER, 7, noPpid)).toBe(false)
  })

  it('FAILS CLOSED on a self-parent loop (PPid == Pid) instead of spinning', () => {
    const loop = readStatusFrom({ 50: statusNode(50, 50, 'x') }) // parent is itself
    expect(isAncestorOf(LEADER, 50, loop)).toBe(false)
  })

  it('does not match across a sibling subtree (1:1 — each leader owns a disjoint tree)', () => {
    // A second launch's leader; SESSION is under LEADER, not under OTHER_LEADER.
    const OTHER_LEADER = 999999
    expect(isAncestorOf(OTHER_LEADER, SESSION, tree)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('correlate — the join by SUBTREE ANCESTRY off the PTY leader, keyed on id (Story 5.5)', () => {
  it('matches a session that DESCENDS from the PTY leader via a wandering reported pid', () => {
    // The real shape: the tracked session is a DEEP descendant of the PTY leader, and the
    // reported pid is a wandering thread of it. resolveTgid(reported) → session leader; the
    // ancestry walk session → npm → leader matches. Neither naive equality NOR the pre-5.5
    // Tgid===leader equality would have matched (the session's Tgid != the leader pid).
    const LEADER = 462856
    const NPM = 463125
    const SESSION = 463321
    const REPORTED = 463325 // a wandering thread of SESSION
    const read = readStatusFrom({
      [REPORTED]: statusThread(REPORTED, SESSION), // thread → Tgid SESSION
      [SESSION]: statusNode(SESSION, NPM, 'MainThread'),
      [NPM]: statusNode(NPM, LEADER, 'npm exec claude'),
      [LEADER]: statusNode(LEADER, 461573, 'claude')
    })
    expect(correlate(LEADER, { id: 'deep', pid: REPORTED }, read)).toEqual({
      id: 'deep',
      matched: true
    })
    expect(SESSION).not.toBe(LEADER) // the session is NOT the leader — only ancestry finds it
  })

  it('does NOT match a session in a DIFFERENT subtree (no false claim)', () => {
    const LEADER = 462856
    const OTHER = 770000
    const read = readStatusFrom({
      770002: statusThread(770002, OTHER), // thread → Tgid OTHER
      [OTHER]: statusNode(OTHER, 1, 'MainThread') // OTHER's parent is init → not under LEADER
    })
    expect(correlate(LEADER, { id: 'other', pid: 770002 }, read)).toEqual({
      id: 'other',
      matched: false
    })
  })

  it('matches a session whose process IS the PTY leader (degenerate ancestry)', () => {
    // If a future claude makes the tracked session the PTY leader itself, ancestry still matches.
    const read = readStatusFrom({ 664819: statusThread(664819, 664817) })
    expect(correlate(664817, { id: 'sess-uuid-1', pid: 664819 }, read)).toEqual({
      id: 'sess-uuid-1',
      matched: true
    })
  })

  it('FAILS CLOSED (unmatched, no crash) when the reported pid is gone from /proc (race)', () => {
    const session = { id: 'sess-uuid-3', pid: 888888 }
    const read = readStatusFrom({}) // pid gone → reader throws → caught
    expect(correlate(664817, session, read)).toEqual({ id: 'sess-uuid-3', matched: false })
  })

  it('FAILS CLOSED (unmatched) when status is present but malformed (no Tgid)', () => {
    const session = { id: 'sess-uuid-4', pid: 999 }
    const read = readStatusFrom({ 999: 'Name:\tx\nPid:\t999\n' }) // no Tgid line
    expect(correlate(664817, session, read)).toEqual({ id: 'sess-uuid-4', matched: false })
  })

  it('NEVER uses spawnedPid === reportedPid: a reported pid equal to the leader but with a DIFFERENT Tgid does NOT match', () => {
    // Pathological: reported pid numerically equals the leader, but its OWN Tgid is a thread of
    // another process whose chain never reaches the leader → no match.
    const session = { id: 'sess-uuid-5', pid: 462856 }
    const read = readStatusFrom({
      462856: statusThread(462856, 555000), // Tgid 555000 != leader 462856
      555000: statusNode(555000, 1, 'x') // 555000's parent is init → not under 462856
    })
    expect(correlate(462856, session, read)).toEqual({ id: 'sess-uuid-5', matched: false })
  })

  it('keys the result on id (identity), never on pid', () => {
    const LEADER = 462856
    const SESSION = 463321
    const read = readStatusFrom({
      463325: statusThread(463325, SESSION),
      [SESSION]: statusNode(SESSION, LEADER, 'MainThread'),
      [LEADER]: statusNode(LEADER, 461573, 'claude')
    })
    const result = correlate(LEADER, { id: 'the-stable-uuid', pid: 463325 }, read)
    expect(result.id).toBe('the-stable-uuid')
    expect(Object.keys(result)).toEqual(['id', 'matched']) // no pid in the result
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE `/proc` INTEGRATION CHECK (AC-1, AC-4) — real kernel format.
//
// NOT live claude: a deterministic node sleeper proves the `/proc/<pid>/status`
// plumbing (`readStatusFromProc` → `resolveTgid`) against the real kernel.
//
// REAPING (Guardrail #6 / the 0.1 lesson): the sleeper is spawned `detached` so it
// leads its OWN process group; afterEach SIGKILLs the WHOLE group (negative pid),
// so it dies on every path — no orphans. Skipped on non-Linux (/proc is
// Linux-only) so the suite stays green cross-platform.
// ─────────────────────────────────────────────────────────────────────────────
const onLinux = process.platform === 'linux'
const describeLinux = onLinux ? describe : describe.skip

describeLinux('INTEGRATION — real /proc of a real process (mechanism plumbing is real)', () => {
  // Every spawned process group, killed whole on every path (no orphans).
  const groups: number[] = []

  function killGroup(pgid: number): void {
    try {
      // Negative pid = the whole process group (the detached sleeper + any children).
      process.kill(-pgid, 'SIGKILL')
    } catch {
      // group already gone — fine
    }
  }

  afterEach(() => {
    for (const pgid of groups) killGroup(pgid)
    groups.length = 0
  })

  it('reads real /proc/<pid>/status and resolveTgid returns a sane leader for a real process', () => {
    // A deterministic single-threaded node sleeper; its own pid IS its Tgid (leader).
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
      detached: true
    })
    const pid = child.pid
    expect(pid).toBeTypeOf('number')
    if (pid === undefined) return
    groups.push(pid) // detached → pid is its own pgid

    // resolveTgid against the REAL kernel /proc format, via the production seam.
    const tgid = resolveTgid(pid, readStatusFromProc)
    expect(tgid).toBe(pid) // freshly spawned leader: Tgid == Pid

    // Sanity: the real status blob carries both Pid: and Tgid: lines (the format
    // resolveTgid parses). Assert the format, never log the blob.
    const realBlob = readFileSync(`/proc/${pid}/status`, 'utf8')
    expect(realBlob).toMatch(/^Tgid:\s+\d+/m)
    expect(realBlob).toMatch(/^Pid:\s+\d+/m)
  })
})
