// UX-14 — "is this session id running in a live claude process right now?", asked before a
// Past-sessions Open or a dead pane's Resume spawns `claude --resume <id>`. Two claudes on one
// conversation both append to its transcript; the board's own `already_open` check cannot see a
// claude the operator started in another terminal (or in another profile of this app).
//
// Claude keeps `~/.claude/sessions/<pid>.json` for each live process (claudeSessionFile.ts). This
// reader scans EVERY record — unlike the rebind reader, which opens only records under a launched
// terminal's pty and must stay that narrow — so it answers ONE boolean and nothing else: a record
// whose `sessionId` is the id AND whose pid is alive. The cwd, name and pid are never returned,
// stored, shown or logged; a bad or unreadable file is skipped silently.
//
// FAILS OPEN. A directory that cannot be listed (older claude, none yet) answers "not running": a
// false block of a legitimate resume strands the operator with no way forward, while claude itself
// remains the final judge of what `--resume` may do. A pid probe that throws answers "not running"
// for the same reason. A stale file (claude SIGKILLed before it could delete it) is filtered by
// the liveness probe; a stale file whose pid was since reused would still block (not seen live).
// [.claude/rules/zod-boundaries.md]

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseClaudeSessionFile } from '../../shared/schemas/claudeSessionFile'
import { claudeSessionsDir } from './claudeSessionFile'

export interface RunningElsewhereCheck {
  isRunningElsewhere(sessionId: string): boolean
}

export interface RunningElsewhereDeps {
  sessionsDir: string
  /** May throw (the check then fails open). */
  listDir: (dir: string) => readonly string[]
  /** May throw (that file is skipped). */
  readFile: (path: string) => string
  /** Production: `isPidAliveBySignal`. May throw (treated as not alive). */
  isPidAlive: (pid: number) => boolean
}

/** Only `<pid>.json` is ever opened — the directory also holds `<pid>.<hex>.key` files. */
const RECORD_NAME = /^(\d+)\.json$/

export function createRunningElsewhereCheck(deps: RunningElsewhereDeps): RunningElsewhereCheck {
  const { sessionsDir, listDir, readFile, isPidAlive } = deps

  function isRunningElsewhere(sessionId: string): boolean {
    let names: readonly string[]
    try {
      names = listDir(sessionsDir)
    } catch {
      return false // fail OPEN — see the header
    }
    for (const name of names) {
      const match = RECORD_NAME.exec(name)
      if (match === null) continue
      const pid = Number.parseInt(match[1] ?? '', 10)
      if (!Number.isInteger(pid) || pid <= 0) continue
      let raw: unknown
      try {
        raw = JSON.parse(readFile(join(sessionsDir, name)))
      } catch {
        continue
      }
      const record = parseClaudeSessionFile(raw)
      if (record === null || record.pid !== pid || record.sessionId !== sessionId) continue
      try {
        if (isPidAlive(pid)) return true
      } catch {
        // not provable — keep scanning, never block on it
      }
    }
    return false
  }

  return { isRunningElsewhere }
}

/** `kill(pid, 0)`: delivered ⇒ alive; EPERM ⇒ alive (it exists, it is not ours); else dead. */
export function isPidAliveBySignal(
  pid: number,
  kill: (pid: number, signal: 0) => void = (p, s) => {
    process.kill(p, s)
  }
): boolean {
  try {
    kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: unknown } | null)?.code === 'EPERM'
  }
}

/** The production check over the real sessions directory. */
export function createRunningElsewhereCheckFromFs(): RunningElsewhereCheck {
  return createRunningElsewhereCheck({
    sessionsDir: claudeSessionsDir(),
    listDir: (dir) => readdirSync(dir),
    readFile: (path) => readFileSync(path, 'utf8'),
    isPidAlive: (pid) => isPidAliveBySignal(pid)
  })
}
