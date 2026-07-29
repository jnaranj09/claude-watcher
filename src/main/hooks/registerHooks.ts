// Hook-status feature — idempotent merger of the hook block into the LAUNCHED PROJECT's
// `.claude/settings.local.json`.
//
// PROJECT-scope registration (NOT user-scope): the hook block is written to the
// `.claude/settings.local.json` of the project the operator picked in the create-session
// dialog (see "WHICH DIRECTORY" below for how that dir is resolved). The app therefore only
// ever touches projects it actually launches a session in — it never edits
// `~/.claude/settings.json`.
// (It used to: registering user-scope meant the block reappeared in the global file on
// every app start, undoing an operator who had deliberately scoped hooks per project.)
//
// `settings.local.json` and NOT `settings.json` on purpose: `settings.json` is the SHARED,
// checked-in project file, and a machine-written hook block there shows up as a diff on a
// tracked file. `settings.local.json` is the personal, conventionally-gitignored override —
// the right home for "this one machine runs Claude Watcher".
//
// Failure modes (must never clobber a config the operator wrote by hand):
//   ENOENT → start from {}
//   Unparseable → back up (.corrupt-<epoch>.json) + SKIP (no clobber — we never reset a
//     hand-edited settings file to defaults).
//   Write failure → log + skip (best-effort; not fatal — a launch must still spawn).
//
// Idempotency: dedupe by HOOK_URL. Existing hooks for any event key are preserved
// unchanged. We write ONLY if the merge produced a change (string compare).
// A one-time .bak backup is made before the first real write.
//
// WHICH DIRECTORY (the non-obvious part) — Claude Code resolves `settings.local.json` at the
// REPOSITORY ROOT, not at the cwd: "Lives at the repository root (resolved through worktrees to
// the main checkout). One file covers sessions started in any subdirectory or worktree of the
// repository. Exception: outside git repos, or when the repo root is your home directory, the
// file stays in your starting directory." [https://code.claude.com/docs/en/settings]
// So writing to `<picked cwd>/.claude/` would be WRONG whenever the operator picks a
// subdirectory of a repo — claude would read the repo root's file and never see our hooks, and
// the board would show a permanently-`Connecting` card. `resolveSettingsDir` mirrors that
// resolution; `registerHooks` always goes through it.
//
// NEVER-LOG-THE-VALUE: `projectDir` is an operator filesystem path (it leaks the machine's
// layout), so every log here is a `code=` only — never the path, never the file content.
//
// [spec registerHooks.ts Code Map; .claude/rules/zod-boundaries.md persisted-file row]

import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  mkdirSync,
  rmSync,
  lstatSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { HOOK_URL, REGISTERED_EVENTS } from './hookContract'

/**
 * The directory whose `.claude/settings.local.json` Claude Code will actually READ for a session
 * started in `cwd` — the git repository root, falling back to `cwd` itself.
 *
 * Mirrors the documented resolution (see the file header):
 * - Walk up from `cwd` to the first directory holding a `.git` entry → that is the repo root.
 * - A `.git` FILE (not a dir) means a linked worktree; its `gitdir:` line points into the main
 *   checkout's `.git/worktrees/<name>`, so the main checkout is the prefix before `/.git/`.
 *   Claude resolves worktrees to the main checkout, so we do too.
 * - No `.git` anywhere up the tree → outside a repo → `cwd` (the documented exception).
 * - Repo root === `$HOME` → also the documented exception → `cwd`. (Never scatter a hook block
 *   into `~/.claude/settings.local.json` off the back of a launch in some home-dir subfolder.)
 *
 * FAIL-SOFT: every filesystem probe is wrapped — an EACCES/ENOENT/EIO on the walk falls back to
 * `cwd` rather than throwing. A misplaced settings file degrades to "no status on the board";
 * a throw here would fail the launch entirely (never-crash).
 */
export function resolveSettingsDir(cwd: string): string {
  const start = resolve(cwd)
  let dir = start
  for (;;) {
    const gitPath = join(dir, '.git')
    let kind: 'dir' | 'file' | null = null
    try {
      const st = lstatSync(gitPath)
      kind = st.isDirectory() ? 'dir' : 'file'
    } catch {
      kind = null // no .git here (or unreadable) — keep walking up
    }

    if (kind === 'file') {
      // Linked worktree: `gitdir: /path/to/main/.git/worktrees/<name>`. Resolve to the main
      // checkout. A malformed/unreadable pointer falls back to this dir (still a repo root).
      try {
        const pointer = readFileSync(gitPath, 'utf8').trim()
        const match = /^gitdir:\s*(.+)$/m.exec(pointer)
        const target = match?.[1]?.trim()
        const marker = target === undefined ? -1 : target.indexOf(`${join('.git', 'worktrees')}`)
        if (target !== undefined && marker > 0) {
          return atHome(target.slice(0, marker - 1), start)
        }
      } catch {
        /* fall through to "this dir is the root" */
      }
      return atHome(dir, start)
    }
    if (kind === 'dir') return atHome(dir, start)

    const parent = dirname(dir)
    if (parent === dir) return start // hit the filesystem root — outside any repo
    dir = parent
  }
}

/** The "repo root is $HOME" exception: fall back to the starting dir. */
function atHome(root: string, start: string): string {
  return resolve(root) === resolve(homedir()) ? start : root
}

/**
 * The per-project Claude Code settings file this app writes its hook block into, for a session
 * launched in `cwd`. The ONE definition of the target path — do not re-derive it at a call site.
 */
export function projectSettingsPath(cwd: string): string {
  return join(resolveSettingsDir(cwd), '.claude', 'settings.local.json')
}

export interface RegisterHooksOptions {
  /**
   * The directory the session is being launched in (the operator-picked cwd, already
   * validated at the `session:launch` IPC boundary). The hook block lands in
   * `<repo root of projectDir>/.claude/settings.local.json` — see `resolveSettingsDir`.
   * Unit tests pass a temp dir.
   */
  projectDir: string
  /** Log sink — code only, NEVER settings content or the path. Defaults to console.warn. */
  log?: (message: string) => void
}

/**
 * Idempotently ensure the app's http hook block is present in the settings file Claude Code
 * will read for a session launched in `projectDir`. Safe to call on every launch — dedupes
 * by HOOK_URL.
 *
 * - ENOENT: starts from `{}` (fresh file; `.claude/` is created if missing).
 * - Unparseable: backs up + SKIPs (never clobbers a hand-written settings file).
 * - No change detected: skips the write.
 * - One-time .bak backup before the first real write.
 */
export function registerHooks(options: RegisterHooksOptions): void {
  const settingsPath = projectSettingsPath(options.projectDir)
  const log = options.log ?? ((msg: string): void => console.warn(msg))

  // 1. Read the current file.
  let raw: string | undefined
  try {
    raw = readFileSync(settingsPath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      raw = undefined // start from {}
    } else {
      log(`[c9watch][registerHooks] code=read_error`)
      return
    }
  }

  // 2. Parse (or start from {}).
  let parsed: Record<string, unknown>
  if (raw === undefined) {
    parsed = {}
  } else {
    try {
      const value: unknown = JSON.parse(raw)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('not an object')
      }
      parsed = value as Record<string, unknown>
    } catch {
      // Unparseable: back up + SKIP (never clobber a hand-written project settings file).
      try {
        const backupPath = settingsPath + `.corrupt-${Date.now()}.json`
        renameSync(settingsPath, backupPath)
        log(`[c9watch][registerHooks] code=settings_corrupt_backed_up`)
      } catch {
        log(`[c9watch][registerHooks] code=settings_backup_failed`)
      }
      // Skip — do NOT write defaults over a corrupt operator-written file.
      return
    }
  }

  // 3. Idempotently merge the hook block.
  // Claude Code's hooks structure is:
  // { "hooks": { "<EventName>": [ { "hooks": [ { "type": "http", "url": "..." } ] } ] } }
  // We ensure each REGISTERED_EVENTS key has our HOOK_URL entry, deduped.
  const originalJson = JSON.stringify(parsed, null, 2)

  let hooksRoot = parsed['hooks']
  if (hooksRoot === null || typeof hooksRoot !== 'object' || Array.isArray(hooksRoot)) {
    hooksRoot = {}
  }
  const hooksMap = hooksRoot as Record<string, unknown>

  for (const eventName of REGISTERED_EVENTS) {
    let eventArr = hooksMap[eventName]
    if (!Array.isArray(eventArr)) {
      eventArr = []
    }
    const arr = eventArr as unknown[]

    // Check if our HOOK_URL is already present anywhere in this event's hook list.
    // Each element can be a hook-group object with a nested `hooks` array, or a
    // direct hook object. We look for our URL in any position to ensure deduplication.
    const alreadyPresent = arr.some((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
      const group = entry as Record<string, unknown>
      // Check direct url field
      if (group['url'] === HOOK_URL) return true
      // Check nested hooks array
      const nested = group['hooks']
      if (Array.isArray(nested)) {
        return nested.some((h) => {
          if (h === null || typeof h !== 'object' || Array.isArray(h)) return false
          return (h as Record<string, unknown>)['url'] === HOOK_URL
        })
      }
      return false
    })

    if (!alreadyPresent) {
      // Add a new hook group for this event.
      arr.push({
        hooks: [{ type: 'http', url: HOOK_URL }]
      })
      hooksMap[eventName] = arr
    }
  }

  parsed['hooks'] = hooksMap

  const newJson = JSON.stringify(parsed, null, 2)

  // 4. Write only if the content changed.
  if (newJson === originalJson) {
    return // idempotent — nothing to write
  }

  // 5. One-time .bak backup before the first real write.
  if (raw !== undefined) {
    try {
      copyFileSync(settingsPath, settingsPath + '.bak')
    } catch {
      // Best-effort backup — do not block the write if it fails.
      log(`[c9watch][registerHooks] code=backup_failed`)
    }
  }

  // 6. Write the merged file ATOMICALLY (write a temp sibling, then rename) so a crash
  // mid-write can never corrupt the operator's settings. Ensure the parent dir exists
  // first (a project picked for the first time has no `.claude/` yet).
  const tmpPath = settingsPath + '.tmp'
  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(tmpPath, newJson + '\n', 'utf8')
    renameSync(tmpPath, settingsPath)
  } catch {
    log(`[c9watch][registerHooks] code=write_failed`)
    // Best-effort cleanup of the temp file (ignore failure).
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      /* ignore */
    }
  }
}
