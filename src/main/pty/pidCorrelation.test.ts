// The `/proc` ancestry walk, on SYNTHETIC `/proc`-shaped fixtures via the injected `ReadStatus`
// seam: deterministic, no live processes, no live claude. One Linux-only describe reads the real
// `/proc` through `readStatusFromProc`.
//
// Project: `main-unit` (environment: 'node') — matches the `src/main/**/*.test.ts` glob in
// vitest.config.ts.
import { describe, it, expect } from 'vitest'
import {
  isAncestorOf,
  parseStatusField,
  readStatusFromProc,
  type ReadStatus
} from './pidCorrelation'

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC `/proc/<pid>/status` FIXTURE — grounded in the real live shape.
// ─────────────────────────────────────────────────────────────────────────────

/** A status blob with an explicit PPid, for the ancestry-walk tests (the walk reads PPid).
 *  `Pid == Tgid` (a process leader in the chain). */
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

describe.skipIf(process.platform !== 'linux')('readStatusFromProc — the real /proc', () => {
  it('reads this process status: PPid parses to a number', () => {
    const ppid = parseStatusField(readStatusFromProc(process.pid), 'PPid')
    expect(Number(ppid)).toBeGreaterThanOrEqual(0)
    expect(ppid).toMatch(/^\d+$/)
  })

  it('throws for a pid that does not exist (the fail-closed signal)', () => {
    expect(() => readStatusFromProc(2 ** 31 - 1)).toThrow()
  })
})
