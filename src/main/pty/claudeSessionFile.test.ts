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

/** `/proc/<pid>/status` blobs: the PPid chain the ancestry walk reads. */
function readStatusFrom(table: Readonly<Record<number, number>>): ReadStatus {
  return (pid) => {
    const ppid = table[pid]
    if (ppid === undefined) throw new Error('ENOENT')
    return `Name:\tclaude\nPid:\t${pid}\nPPid:\t${ppid}\n`
  }
}

const TREE = readStatusFrom({ [LEADER]: ELECTRON, [CHILD]: LEADER, [STRANGER]: 1 })

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

  it('collects every id under the leader (a nested claude keeps its own record)', () => {
    const { source } = sourceOver({
      [`${LEADER}.json`]: record(LEADER, 'sess-B'),
      [`${CHILD}.json`]: record(CHILD, 'sess-nested')
    })
    expect([...source.currentSessionIdsUnder(LEADER)].sort()).toEqual(['sess-B', 'sess-nested'])
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
