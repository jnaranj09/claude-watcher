// Fixtures for the launchSession.*.test.ts files: a synthetic `/proc` (status blobs and the claude
// launch tree), a Session stub, a fake terminal manager and the production-shaped spawn factory.
// Never shipped.
import type { LaunchTerminalManager } from '../main/pty/launchSession'
import type { ReadStatus } from '../main/pty/pidCorrelation'
import type { Session } from '../shared/schemas/session'

// ── SYNTHETIC `/proc` FIXTURES (grounded in the REAL Story-5.5 live tree) ──────────────────────
// A `/proc/<pid>/status` blob carrying the fields the correlation reads: Tgid (resolve a wandering
// thread to its process leader) + PPid (walk ancestry up to the PTY leader).
export function status(pid: number, tgid: number, ppid: number, name = 'x'): string {
  return [
    `Name:\t${name}`,
    'State:\tS (sleeping)',
    `Tgid:\t${tgid}`,
    `Pid:\t${pid}`,
    `PPid:\t${ppid}`,
    ''
  ].join('\n')
}
export function readStatusFrom(table: Readonly<Record<number, string>>): ReadStatus {
  return (pid: number): string => {
    const blob = table[pid]
    if (blob === undefined) throw new Error('ENOENT')
    return blob
  }
}

// The live claude 2.1.186 launch tree: leader → npm exec claude → MainThread (the tracked session)
// → a wandering reported thread. pidOf returns LEADER_PID; c9watch reports REPORTED_PID.
export const ELECTRON_PID = 461573 // the PTY leader's parent (above the PTY — NOT under the leader)
export const LEADER_PID = 462856 // the PTY leader (what pidOf returns); the claude ELF (shell exec'd it)
export const NPM_PID = 463125 // `npm exec claude`, child of the leader
export const SESSION_TGID = 463321 // the tracked session's process leader (MainThread), child of npm
export const REPORTED_PID = 463325 // a wandering reported thread of the session (its Tgid == SESSION_TGID)

/** The readStatus table for a session that DESCENDS from LEADER_PID (the happy-path ancestry). */
export function launchTree(): Record<number, string> {
  return {
    // the wandering reported thread → resolves to the session leader Tgid.
    [REPORTED_PID]: status(REPORTED_PID, SESSION_TGID, SESSION_TGID, 'MainThread'),
    // the session leader → parent is npm exec claude.
    [SESSION_TGID]: status(SESSION_TGID, SESSION_TGID, NPM_PID, 'MainThread'),
    // npm exec claude → parent is the PTY leader.
    [NPM_PID]: status(NPM_PID, NPM_PID, LEADER_PID, 'npm exec claude'),
    // the PTY leader → parent is electron (the ancestry walk STOPS at LEADER_PID, so this is only
    // for completeness; isAncestorOf checks `pid === LEADER_PID` before reading it).
    [LEADER_PID]: status(LEADER_PID, LEADER_PID, ELECTRON_PID, 'claude')
  }
}

/** A minimal Session for the correlation (only id + pid are read). The rest satisfy the type. */
export function session(id: string, pid: number): Session {
  return {
    id,
    pid,
    status: 'Working',
    projectPath: '/p',
    sessionName: 'n'
  } as Session
}

/** A fake terminal manager: returns a fixed PTY-leader pid from pidOf() (the launch SPAWN rides the
 *  existing terminal:open handler — the service only reads pidOf for the ancestry correlation). */
export function fakeTerminalManager(leaderByTerminal: Record<string, number | null>): {
  manager: LaunchTerminalManager
} {
  const manager: LaunchTerminalManager = {
    pidOf: (terminalId): number | null => leaderByTerminal[terminalId] ?? null
  }
  return { manager }
}

// Story 6.2 — the production-shaped spawn FACTORY fixture: mirrors index.ts `rawClaudeSpawn`
// (the `$SHELL -l -c` wrapper composing `claude --session-id '<uuid>'`, single-quoted).
export function shellClaudeSpawn(sessionId: string): {
  file: string
  args: string[]
  env: Record<string, string>
} {
  return {
    file: '/bin/bash',
    args: ['-l', '-c', `claude --session-id '${sessionId}'`],
    env: { PATH: '/usr/bin' }
  }
}
