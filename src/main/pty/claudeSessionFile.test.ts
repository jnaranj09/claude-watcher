// Claude per-process session records — unit tests for the injectable, never-throwing source
// that answers "which session ids does claude record for the processes under this PTY?".
//
// Runs under the `main-unit` Vitest project (node). Pure over injected fs + /proc seams —
// no real files, no real /proc.
//
// Layout mirrored from a live `~/.claude/sessions/` (claude 2.1.257, 2026-09-01):
//   32969.json                    ← the record the app reads (one per live claude process)
//   32969.<64 hex>.key            ← a sibling the app must never open
//
// Every case is a FAULT-INJECTION target: removing the guard it names in claudeSessionFile.ts
// must turn it red.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeSessionsDir, createProcessSessionSource } from './claudeSessionFile'
import type { ReadStatus } from './pidCorrelation'

const DIR = '/home/operator/.claude/sessions'
const LEADER = 32969 // the PTY leader (what terminalManager.pidOf returns)
const CHILD = 40001 // a claude that is a CHILD of the leader (a non-exec'ing shell shape)
const STRANGER = 50001 // an unrelated claude process (a manual `claude` elsewhere)
const ELECTRON = 2310186 // the leader's parent — above the PTY, never "under" it

const SHELL = 40002 // a shell claude's Bash tool runs (between an outer and a nested claude)
const NESTED = 40003 // a `claude -p` that an outer claude's Bash tool started (R18)

/** `/proc/<pid>/status` blobs: the PPid chain the ancestry walk reads, and each process's
 *  `Name:` (a bare number means a process named `claude`). */
function readStatusFrom(
  table: Readonly<Record<number, number | readonly [ppid: number, name: string]>>
): ReadStatus {
  return (pid) => {
    const entry = table[pid]
    if (entry === undefined) throw new Error('ENOENT')
    const [ppid, name] = typeof entry === 'number' ? [entry, 'claude'] : entry
    return `Name:\t${name}\nPid:\t${pid}\nPPid:\t${ppid}\n`
  }
}

// The shell-did-not-exec shape: the PTY leader is a `bash`, claude is its child.
const TREE = readStatusFrom({
  [LEADER]: [ELECTRON, 'bash'],
  [CHILD]: LEADER,
  [STRANGER]: 1
})

function record(pid: number, sessionId: string): string {
  return JSON.stringify({ pid, sessionId, cwd: '/home/operator/project', name: 'ZYPF' })
}

/** An in-memory sessions dir: file name → content (or a thrower for an unreadable file). */
function sourceOver(
  files: Readonly<Record<string, string | (() => string)>>,
  readStatus: ReadStatus = TREE
): { source: ReturnType<typeof createProcessSessionSource>; opened: string[] } {
  const opened: string[] = []
  const source = createProcessSessionSource({
    sessionsDir: DIR,
    listDir: (dir) => {
      expect(dir).toBe(DIR)
      return Object.keys(files)
    },
    readFile: (path) => {
      opened.push(path)
      const name = path.slice(DIR.length + 1)
      const content = files[name]
      if (content === undefined) throw new Error('ENOENT')
      return typeof content === 'function' ? content() : content
    },
    readStatus
  })
  return { source, opened }
}

describe('createProcessSessionSource — the exact "pid P now runs session B" proof', () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[]
  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {})
    ]
  })
  afterEach(() => {
    // The file carries the operator's cwd and session name — nothing here may ever log.
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('returns the id recorded for the leader itself, without touching /proc', () => {
    const noProc: ReadStatus = () => {
      throw new Error('must not walk /proc when the leader IS the recorded process')
    }
    const { source } = sourceOver({ [`${LEADER}.json`]: record(LEADER, 'sess-B') }, noProc)
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['sess-B'])
  })

  it('returns the id recorded for a DESCENDANT of the leader (claude below a shell)', () => {
    const { source } = sourceOver({ [`${CHILD}.json`]: record(CHILD, 'sess-child') })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['sess-child'])
  })

  it('ignores records of processes NOT under the leader (a stranger, the parent electron)', () => {
    const { source, opened } = sourceOver({
      [`${STRANGER}.json`]: record(STRANGER, 'sess-stranger'),
      [`${ELECTRON}.json`]: record(ELECTRON, 'sess-parent')
    })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
    // Not under the leader ⇒ never even opened (the ancestry walk gates the read).
    expect(opened).toEqual([])
  })

  it('never opens a file that is not `<digits>.json` (the sibling .key files)', () => {
    const { source, opened } = sourceOver({
      [`${LEADER}.0dafd877e38d540f625d9a5833ac66c6.key`]: 'secret',
      'notes.txt': 'x',
      [`${LEADER}.json`]: record(LEADER, 'sess-B')
    })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['sess-B'])
    expect(opened).toEqual([`${DIR}/${LEADER}.json`])
  })

  it('ignores a record whose pid field disagrees with its file name (stale / copied file)', () => {
    const { source } = sourceOver({ [`${LEADER}.json`]: record(CHILD, 'sess-B') })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('skips an unreadable file, invalid JSON, and a malformed record — and never throws', () => {
    const { source } = sourceOver({
      [`${LEADER}.json`]: () => {
        throw new Error('EACCES')
      },
      [`${CHILD}.json`]: '{ not json',
      [`${STRANGER}.json`]: JSON.stringify({ pid: STRANGER })
    })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('returns [] when the sessions dir cannot be listed (older claude, no dir yet)', () => {
    const source = createProcessSessionSource({
      sessionsDir: DIR,
      listDir: () => {
        throw new Error('ENOENT')
      },
      readFile: () => {
        throw new Error('must not read')
      },
      readStatus: TREE
    })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  // R18 — only the terminal's OWN claude (the OUTERMOST one) is a proof. A claude that another
  // claude started (its Bash tool running `claude -p`) records its own id under the same leader.
  // Live tree 2026-09-28, claude 2.1.284: claude(leader) → bash → claude -p → npm exec claude.
  const NESTED_TREE = readStatusFrom({
    [LEADER]: ELECTRON, // the login shell exec'd claude: the leader IS claude
    [SHELL]: [LEADER, 'bash'],
    [NESTED]: SHELL
  })

  it('drops a NESTED claude: its record sits under the leader, but another claude is above it', () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: record(LEADER, 'sess-B'),
        [`${NESTED}.json`]: record(NESTED, 'sess-nested')
      },
      NESTED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['sess-B'])
  })

  it('drops a nested claude even when the outer claude left no readable record (its Name says claude)', () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: '{ not json',
        [`${NESTED}.json`]: record(NESTED, 'sess-nested')
      },
      NESTED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('drops a nested claude whose outer claude has a record but a different process Name', () => {
    const tree = readStatusFrom({
      [LEADER]: [ELECTRON, 'bash'],
      [CHILD]: [LEADER, 'node'], // an npm-installed outer claude that kept node's name
      [SHELL]: [CHILD, 'bash'],
      [NESTED]: SHELL
    })
    const { source } = sourceOver(
      {
        [`${CHILD}.json`]: record(CHILD, 'sess-B'),
        [`${NESTED}.json`]: record(NESTED, 'sess-nested')
      },
      tree
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['sess-B'])
  })

  it('drops a candidate when a process between it and the leader cannot be read (fail closed)', () => {
    const tree = readStatusFrom({ [LEADER]: [ELECTRON, 'bash'], [NESTED]: SHELL }) // SHELL gone
    const gated: ReadStatus = (pid) => (pid === SHELL ? '' : tree(pid))
    const { source } = sourceOver({ [`${NESTED}.json`]: record(NESTED, 'sess-x') }, gated)
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('drops a candidate when an ancestor has no readable Name (cannot tell it is not claude)', () => {
    const tree = readStatusFrom({ [LEADER]: [ELECTRON, 'bash'], [NESTED]: SHELL, [SHELL]: LEADER })
    const noName: ReadStatus = (pid) =>
      pid === SHELL ? `Pid:\t${SHELL}\nPPid:\t${LEADER}\n` : tree(pid)
    const { source } = sourceOver({ [`${NESTED}.json`]: record(NESTED, 'sess-x') }, noName)
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it("keeps every OUTERMOST claude (two siblings under a shell leader) — ambiguity is the caller's call", () => {
    const tree = readStatusFrom({
      [LEADER]: [ELECTRON, 'bash'],
      [CHILD]: LEADER,
      [NESTED]: LEADER
    })
    const { source } = sourceOver(
      {
        [`${CHILD}.json`]: record(CHILD, 'sess-a'),
        [`${NESTED}.json`]: record(NESTED, 'sess-b')
      },
      tree
    )
    expect([...source.currentSessionIdsUnder(LEADER)].sort()).toEqual(['sess-a', 'sess-b'])
  })

  // Agent view (claude 2.1.291, drive runs 2026-10-06): ← moves the conversation into a
  // background job run by claude's daemon — NOT under the pty. The terminal's record keeps its
  // OLD sessionId and gains `parkedJobId`; the job's record carries `kind:"bg"` + `jobId` and the
  // session id every later hook uses.
  const JOB = 60001 // the daemon process running the parked job (parent: the daemon, not the pty)
  const OTHER_JOB = 60002
  const PARKED_TREE = readStatusFrom({
    [LEADER]: ELECTRON, // the leader IS claude (login shell exec'd it)
    [JOB]: 1,
    [OTHER_JOB]: 1,
    [STRANGER]: 1
  })
  function rec(pid: number, sessionId: string, extra: Record<string, unknown>): string {
    return JSON.stringify({ pid, sessionId, cwd: '/home/operator/project', name: 'ZYPF', ...extra })
  }
  const PARKED = rec(LEADER, 'sess-orig', { kind: 'interactive', parkedJobId: 'cda9ce2d' })

  it("parked: returns the JOB's current id, never the terminal's own (stale) id", () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: PARKED,
        [`${JOB}.json`]: rec(JOB, 'cda9ce2d-job', { kind: 'bg', jobId: 'cda9ce2d' })
      },
      PARKED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['cda9ce2d-job'])
    expect(source.parkedUnder(LEADER)).toBe(true)
  })

  it('parked + /clear inside the job: same jobId, new sessionId → the new id', () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: PARKED,
        [`${JOB}.json`]: rec(JOB, '36bc4859-new', { kind: 'bg', jobId: 'cda9ce2d' })
      },
      PARKED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['36bc4859-new'])
  })

  it('parked but the job record is not written yet → nothing now, found on a later call', () => {
    const files: Record<string, string> = { [`${LEADER}.json`]: PARKED }
    const { source } = sourceOver(files, PARKED_TREE)
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
    files[`${JOB}.json`] = rec(JOB, 'cda9ce2d-job', { kind: 'bg', jobId: 'cda9ce2d' })
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['cda9ce2d-job'])
  })

  it('parked: TWO job records with that jobId → ambiguous, nothing', () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: PARKED,
        [`${JOB}.json`]: rec(JOB, 'a-job', { kind: 'bg', jobId: 'cda9ce2d' }),
        [`${OTHER_JOB}.json`]: rec(OTHER_JOB, 'b-job', { kind: 'bg', jobId: 'cda9ce2d' })
      },
      PARKED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('parked: a spare (other jobId) or a non-bg record with the right jobId never matches', () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: PARKED,
        [`${JOB}.json`]: rec(JOB, 'spare', { kind: 'bg', jobId: '96ab0e1a', spare: true }),
        [`${OTHER_JOB}.json`]: rec(OTHER_JOB, 'not-bg', { kind: 'interactive', jobId: 'cda9ce2d' })
      },
      PARKED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('parked: a job record whose pid disagrees with its file name never matches', () => {
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: PARKED,
        [`${JOB}.json`]: rec(OTHER_JOB, 'copied', { kind: 'bg', jobId: 'cda9ce2d' })
      },
      PARKED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual([])
  })

  it('two parked terminals in one folder each find ONLY their own job', () => {
    const LEADER2 = 32970
    const tree = readStatusFrom({
      [LEADER]: ELECTRON,
      [LEADER2]: ELECTRON,
      [JOB]: 1,
      [OTHER_JOB]: 1
    })
    const { source } = sourceOver(
      {
        [`${LEADER}.json`]: PARKED,
        [`${LEADER2}.json`]: rec(LEADER2, 'sess-orig-2', { parkedJobId: '0a5714c6' }),
        [`${JOB}.json`]: rec(JOB, 'cda9ce2d-job', { kind: 'bg', jobId: 'cda9ce2d' }),
        [`${OTHER_JOB}.json`]: rec(OTHER_JOB, '0a5714c6-job', { kind: 'bg', jobId: '0a5714c6' })
      },
      tree
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['cda9ce2d-job'])
    expect(source.currentSessionIdsUnder(LEADER2)).toEqual(['0a5714c6-job'])
  })

  it('NOT parked: still never opens a record outside the tree, and parkedUnder is false', () => {
    const { source, opened } = sourceOver(
      {
        [`${LEADER}.json`]: rec(LEADER, 'sess-B', { kind: 'interactive' }),
        [`${JOB}.json`]: rec(JOB, 'cda9ce2d-job', { kind: 'bg', jobId: 'cda9ce2d' })
      },
      PARKED_TREE
    )
    expect(source.currentSessionIdsUnder(LEADER)).toEqual(['sess-B'])
    expect(source.parkedUnder(LEADER)).toBe(false)
    expect(opened).toEqual([`${DIR}/${LEADER}.json`, `${DIR}/${LEADER}.json`])
  })

  it('parkedUnder is false when the dir cannot be listed', () => {
    const source = createProcessSessionSource({
      sessionsDir: DIR,
      listDir: () => {
        throw new Error('ENOENT')
      },
      readFile: () => {
        throw new Error('must not read')
      },
      readStatus: TREE
    })
    expect(source.parkedUnder(LEADER)).toBe(false)
  })
})

describe('claudeSessionsDir — where claude keeps the records', () => {
  it("honours CLAUDE_CONFIG_DIR (claude's documented config-dir override)", () => {
    expect(claudeSessionsDir({ CLAUDE_CONFIG_DIR: '/custom/claude' })).toBe(
      '/custom/claude/sessions'
    )
  })

  it('defaults to ~/.claude/sessions when the override is unset or blank', () => {
    expect(claudeSessionsDir({})).toBe(join(homedir(), '.claude', 'sessions'))
    expect(claudeSessionsDir({ CLAUDE_CONFIG_DIR: '' })).toBe(
      join(homedir(), '.claude', 'sessions')
    )
  })
})
