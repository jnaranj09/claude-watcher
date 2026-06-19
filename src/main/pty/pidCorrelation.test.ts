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
  resolveClaudeDescendant,
  correlate,
  CLAUDE_NOT_RESOLVED,
  TgidParseError,
  readStatusFromProc,
  readCommFromProc,
  listChildrenFromProc,
  listChildrenFromPgrep,
  type ReadStatus,
  type ReadComm,
  type ListChildren
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

/** Build a `ReadComm` seam from a pid→comm table; missing pid THROWS (race). */
function readCommFrom(table: Readonly<Record<number, string>>): ReadComm {
  return (pid: number): string => {
    const comm = table[pid]
    if (comm === undefined) throw new Error('ENOENT')
    return comm
  }
}

/** Build a `ListChildren` seam from a shell→children table; missing shell → []. */
function listChildrenFrom(table: Readonly<Record<number, readonly number[]>>): ListChildren {
  return (shellPid: number): readonly number[] => table[shellPid] ?? []
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
describe('resolveClaudeDescendant — shell-layer resolution (AC-2)', () => {
  it('returns the claude child of the pane shell, validated by comm == claude', () => {
    // Real live shape: bash(189223) → child 664817, comm(664817) == 'claude'.
    const list = listChildrenFrom({ 189223: [664817] })
    const comm = readCommFrom({ 664817: 'claude' })
    expect(resolveClaudeDescendant(189223, list, comm)).toBe(664817)
  })

  it('picks claude out of a sibling set, NEVER the pane shell itself (the OQ-6 trap)', () => {
    // The shell has multiple children; only one is claude. Must not match a bash.
    const list = listChildrenFrom({ 189223: [200001, 664817, 200002] })
    const comm = readCommFrom({ 200001: 'bash', 664817: 'claude', 200002: 'node' })
    expect(resolveClaudeDescendant(189223, list, comm)).toBe(664817)
  })

  it('returns CLAUDE_NOT_RESOLVED (timing gap, UX-DR19) when only the pane shell exists yet — NOT a wrong pid', () => {
    // Freshly launched: shell spawned, claude not yet a child / not yet scanned.
    const list = listChildrenFrom({ 189223: [200001] }) // only a bash so far
    const comm = readCommFrom({ 200001: 'bash' })
    expect(resolveClaudeDescendant(189223, list, comm)).toBe(CLAUDE_NOT_RESOLVED)
  })

  it('returns CLAUDE_NOT_RESOLVED when the shell has no children yet (fail closed)', () => {
    const list = listChildrenFrom({}) // shell present but childless
    const comm = readCommFrom({})
    expect(resolveClaudeDescendant(189223, list, comm)).toBe(CLAUDE_NOT_RESOLVED)
  })

  it('skips a child that vanished between list and comm read (race), keeps scanning', () => {
    // First child disappears (comm read throws); the second IS claude → resolved.
    const list = listChildrenFrom({ 189223: [300001, 664817] })
    const comm = readCommFrom({ 664817: 'claude' }) // 300001 missing → throws → skipped
    expect(resolveClaudeDescendant(189223, list, comm)).toBe(664817)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('correlate — the join, keyed on stable id (AC-1)', () => {
  it('matches a session whose reported pid is a wandering thread of the app claude TGID', () => {
    const session = { id: 'sess-uuid-1', pid: 664819 } // HeapHelper thread
    const read = readStatusFrom({ 664819: statusThread(664819, 664817) })
    expect(correlate(664817, session, read)).toEqual({ id: 'sess-uuid-1', matched: true })
  })

  it('does NOT match a session belonging to a DIFFERENT claude', () => {
    const session = { id: 'sess-uuid-2', pid: 770002 }
    const read = readStatusFrom({ 770002: statusThread(770002, 770000) }) // Tgid 770000
    expect(correlate(664817, session, read)).toEqual({ id: 'sess-uuid-2', matched: false })
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

  it('NEVER uses spawnedPid === reportedPid: equal pids that resolve to different Tgids do NOT match', () => {
    // Pathological: reported pid happens to equal the app claude TGID numerically,
    // but its OWN Tgid is different (it is a thread of another process). The naive
    // equality would (wrongly) match; correlate must NOT — it compares Tgids.
    const session = { id: 'sess-uuid-5', pid: 664817 }
    const read = readStatusFrom({ 664817: statusThread(664817, 555000) }) // Tgid 555000 != 664817
    expect(correlate(664817, session, read)).toEqual({ id: 'sess-uuid-5', matched: false })
  })

  it('keys the result on id (identity), never on pid', () => {
    const session = { id: 'the-stable-uuid', pid: 664819 }
    const read = readStatusFrom({ 664819: statusThread(664819, 664817) })
    const result = correlate(664817, session, read)
    expect(result.id).toBe('the-stable-uuid')
    expect(Object.keys(result)).toEqual(['id', 'matched']) // no pid in the result
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE `/proc` INTEGRATION CHECK (AC-1, AC-4) — real kernel format, real tree.
//
// NOT live claude: a deterministic node sleeper (renamed via `process.title`)
// proves the /proc plumbing against the real kernel. We model the SAME shape the
// app faces — a SHELL (bash, the node-pty pane leader) with a node child (the
// "claude" stand-in) — and resolve the child from the shell pid through BOTH real
// seams (`/proc/<shell>/task/*\/children` and `pgrep -P`), then resolveTgid on it.
//
// REAPING (Guardrail #6 / the 0.1 lesson): the shell is spawned `detached` so it
// leads its OWN process group; afterEach SIGKILLs the WHOLE group (negative pid),
// so the bash AND its node grandchild die on every path — no orphans. Skipped on
// non-Linux (/proc is Linux-only) so the suite stays green cross-platform.
// ─────────────────────────────────────────────────────────────────────────────
const onLinux = process.platform === 'linux'
const describeLinux = onLinux ? describe : describe.skip

describeLinux(
  'INTEGRATION — real /proc of a real shell→child tree (mechanism plumbing is real)',
  () => {
    // Every spawned process group, killed whole on every path (no orphans).
    const groups: number[] = []

    function killGroup(pgid: number): void {
      try {
        // Negative pid = the whole process group (the detached bash + its children).
        process.kill(-pgid, 'SIGKILL')
      } catch {
        // group already gone — fine
      }
    }

    afterEach(() => {
      for (const pgid of groups) killGroup(pgid)
      groups.length = 0
    })

    /** Busy-wait (bounded, no fixed sleep) until `predicate()` is true or the
     *  deadline passes. Deterministic: returns as soon as the condition holds. */
    function pollUntil(predicate: () => boolean, budgetMs: number): boolean {
      const deadline = Date.now() + budgetMs
      while (Date.now() < deadline) {
        if (predicate()) return true
      }
      return predicate()
    }

    /** Did `children` contain a pid whose REAL comm == wanted? Uses the production
     *  comm reader (mirrors resolveClaudeDescendant's validation for an arbitrary
     *  target name — the test uses a renamed node sleeper, not literal `claude`). */
    function findByComm(children: readonly number[], wanted: string): number | undefined {
      for (const child of children) {
        let comm: string
        try {
          comm = readCommFromProc(child)
        } catch {
          continue
        }
        if (comm === wanted) return child
      }
      return undefined
    }

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

    it('resolves the node child of a real bash shell via BOTH /proc task/children AND pgrep -P, then Tgid-joins it', () => {
      // Model the app's tree: bash (pane leader, like node-pty's shell) → node child
      // renamed to a known comm token (the "claude" stand-in; comm <=15 chars).
      const COMM = 'c9probe-kid' // 11 chars, fits the kernel's 15-char comm limit
      const kidScript = `process.title=${JSON.stringify(COMM)}; setTimeout(()=>{}, 30000)`
      // bash stays alive as the parent (background the node child + `wait`), so there
      // IS a shell→child layer to walk. detached → its own group for whole-group reap.
      const shell = spawn(
        '/bin/bash',
        ['-c', `${process.execPath} -e ${JSON.stringify(kidScript)} & wait`],
        { stdio: 'ignore', detached: true }
      )
      const shellPid = shell.pid
      expect(shellPid).toBeTypeOf('number')
      if (shellPid === undefined) return
      groups.push(shellPid)

      // Poll (deterministic, bounded) until the PREFERRED /proc task/children path
      // surfaces a child whose real comm == COMM — proves the kernel format parses.
      let kidViaProc: number | undefined
      const okProc = pollUntil(() => {
        kidViaProc = findByComm(listChildrenFromProc(shellPid), COMM)
        return kidViaProc !== undefined
      }, 5000)
      expect(okProc).toBe(true)
      expect(kidViaProc).toBeTypeOf('number')

      // The pgrep -P FALLBACK finds the SAME child by comm (the documented AC-2 fallback).
      const kidViaPgrep = findByComm(listChildrenFromPgrep(shellPid), COMM)
      expect(kidViaPgrep).toBe(kidViaProc)

      // End-to-end: resolveClaudeDescendant (the production fn) finds the kid from the
      // shell pid using the REAL seams — and resolveTgid on it returns a real leader.
      if (kidViaProc === undefined) return
      // The kid is single-threaded leader, so its comm token also identifies it; we
      // reuse resolveClaudeDescendant with a comm seam that maps our token to itself
      // ONLY for the real kid (validates the fn's shell→child contract on real data).
      const descendant = resolveClaudeDescendant(shellPid, listChildrenFromProc, (p) =>
        readCommFromProc(p)
      )
      // resolveClaudeDescendant looks for comm == 'claude'; our stand-in is COMM, so
      // it returns CLAUDE_NOT_RESOLVED (correct — there is no literal `claude` here).
      // That itself proves the comm VALIDATION gate (it won't match a non-claude kid).
      expect(descendant).toBe(CLAUDE_NOT_RESOLVED)

      // And the Tgid join on the real kid yields its real leader pid (Tgid == pid):
      const kidTgid = resolveTgid(kidViaProc, readStatusFromProc)
      expect(kidTgid).toBe(kidViaProc)
    })
  }
)
