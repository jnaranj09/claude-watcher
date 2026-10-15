// The `/proc` walk every e2e spec uses to find (and reap) the `claude` an app launched.
//
// LINUX-ONLY, like the app's KDE-first scope: it reads `/proc/<pid>/status` and `/cmdline`.
// `tests/drive/driveApp.mjs` holds its own copy (it cannot import TypeScript).

import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

// The checkout root. Every Electron helper (renderer / GPU / zygote) carries it in its cmdline.
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

export interface Descendant {
  pid: number
  cmdline: string
}

/**
 * Is this descendant the LAUNCHED `claude`, rather than one of Electron's own helper processes?
 *
 * A bare `cmdline.includes('claude')` is NOT safe: the checkout path itself can contain "claude"
 * (this repo lives at `.../claude-watcher/claude-watcher/`), so EVERY Electron zygote/renderer
 * matched it. Measured on this machine: 6 of 7 descendants matched with NO session launched at
 * all. That made the launch spec's primary assertion VACUOUS (it passed whether or not `claude`
 * ever spawned) and made the native-engine dead-pane test SIGKILL the app under test.
 *
 * Excluding anything whose cmdline mentions the checkout root removes all of Electron's own
 * processes while leaving the real `claude` (resolved to an absolute path outside the repo,
 * e.g. `~/.local/bin/claude` — see `resolveClaudeBin` in src/main/index.ts) untouched.
 */
export function isLaunchedClaude(cmdline: string): boolean {
  if (cmdline === '' || cmdline.includes(PROJECT_ROOT)) return false
  return cmdline.includes('claude')
}

/** Read a process's PPid from /proc/<pid>/status (robust to a comm with spaces/parens). */
export function ppidOf(pid: number): number | null {
  try {
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s+(\d+)/m)
    return m ? Number(m[1]) : null
  } catch {
    return null // the process may have exited between listing and reading — skip it
  }
}

/** Read a process's cmdline (NUL-separated → space-joined). Empty on a gone/denied process. */
export function cmdlineOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

/** All processes that descend (transitively) from rootPid, with their cmdlines. */
export function descendantCmdlines(rootPid: number): Descendant[] {
  const pids = readdirSync('/proc')
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
  const children = new Map<number, number[]>()
  for (const pid of pids) {
    const pp = ppidOf(pid)
    if (pp === null) continue
    const arr = children.get(pp) ?? []
    arr.push(pid)
    children.set(pp, arr)
  }
  const out: Descendant[] = []
  const stack = [...(children.get(rootPid) ?? [])]
  const seen = new Set<number>()
  while (stack.length > 0) {
    const pid = stack.pop()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    out.push({ pid, cmdline: cmdlineOf(pid) })
    stack.push(...(children.get(pid) ?? []))
  }
  return out
}

/** Poll for a descendant of rootPid whose cmdline contains `claude`. The spawn is async (click →
 *  launch → openLaunchedTerminal → EmbeddedTerminal mount → terminal:open → main spawns), so we
 *  poll rather than check once. Returns the full descendant list; THROWS on timeout, naming every
 *  descendant it saw, so a claude that never spawned fails here and not as a later hook failure. */
export async function waitForClaudeDescendant(
  rootPid: number,
  timeoutMs: number
): Promise<Descendant[]> {
  const deadline = Date.now() + timeoutMs
  let last: Descendant[] = []
  while (Date.now() < deadline) {
    last = descendantCmdlines(rootPid)
    if (last.some((d) => isLaunchedClaude(d.cmdline))) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `no \`claude\` descendant of pid ${rootPid} within ${timeoutMs}ms. Descendant cmdlines:\n` +
      last.map((d) => `  ${d.pid}: ${d.cmdline || '(empty)'}`).join('\n')
  )
}

/** SIGKILL every launched `claude` under rootPid. The PTY child sits in its own session, so the
 *  Electron process-group kill does not reach it (the master-fd close usually reaps it on app
 *  death, but don't rely on it). */
export function killLaunchedClaudes(rootPid: number): void {
  for (const d of descendantCmdlines(rootPid)) {
    if (!isLaunchedClaude(d.cmdline)) continue
    try {
      process.kill(d.pid, 'SIGKILL')
    } catch {
      /* the process may already be gone */
    }
  }
}
