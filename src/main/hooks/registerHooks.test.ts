// Hook-status feature — unit tests for registerHooks.
//
// Runs under the `main-unit` Vitest project (node). Each test passes a TEMP directory as
// `projectDir`, so the merge lands in `<tmp>/.claude/settings.local.json` and no real project
// (and never ~/.claude/settings.json) is touched. [spec Tasks; spec registerHooks.ts Code Map]

import { describe, it, expect, vi } from 'vitest'
import { registerHooks, projectSettingsPath, resolveSettingsDir } from './registerHooks'
import { HOOK_URL, REGISTERED_EVENTS } from './hookContract'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// Each test gets its own temp PROJECT directory to avoid cross-test pollution. The `.claude/`
// subdir is deliberately NOT created — registerHooks must create it (a project picked for the
// first time has no `.claude/` yet).
function makeTempDir(): string {
  const dir = join(tmpdir(), `hook-reg-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function settingsFile(dir: string): string {
  return projectSettingsPath(dir)
}

/** Seed a pre-existing settings.local.json (creating `.claude/` first, as a real project would). */
function seedSettings(dir: string, value: unknown): string {
  const path = settingsFile(dir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8')
  return path
}

function readSettings(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('registerHooks — idempotent merge into the project settings.local.json', () => {
  it('targets <projectDir>/.claude/settings.local.json — never the user-global settings', () => {
    const dir = makeTempDir()
    expect(projectSettingsPath(dir)).toBe(join(dir, '.claude', 'settings.local.json'))

    registerHooks({ projectDir: dir, log: vi.fn<(msg: string) => void>() })

    // The block landed in the project file, and the SHARED project settings.json is untouched.
    expect(existsSync(join(dir, '.claude', 'settings.local.json'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the .claude/ dir when the project has none (atomic, dir-safe write)', () => {
    const dir = makeTempDir()
    expect(existsSync(join(dir, '.claude'))).toBe(false)

    const log = vi.fn<(msg: string) => void>()
    registerHooks({ projectDir: dir, log })

    // The parent dir was created and the file written with our hook block; nothing logged.
    expect(existsSync(settingsFile(dir))).toBe(true)
    expect(log).not.toHaveBeenCalled()
    const parsed = readSettings(settingsFile(dir)) as Record<string, unknown>
    expect(parsed['hooks']).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })

  it('ENOENT: creates the file from {} with the hook block', () => {
    const dir = makeTempDir()
    const path = settingsFile(dir)
    expect(existsSync(path)).toBe(false)

    const log = vi.fn<(msg: string) => void>()
    registerHooks({ projectDir: dir, log })

    expect(existsSync(path)).toBe(true)
    const parsed = readSettings(path) as Record<string, unknown>
    const hooks = parsed['hooks'] as Record<string, unknown>
    expect(hooks).toBeDefined()
    // Notification is a registered event (Phase 2: permission_prompt → needs-you).
    expect(REGISTERED_EVENTS).toContain('Notification')
    expect(hooks['Notification']).toBeDefined()
    for (const eventName of REGISTERED_EVENTS) {
      const arr = hooks[eventName] as unknown[]
      expect(Array.isArray(arr)).toBe(true)
      const hasOurUrl = arr.some((entry) => {
        const e = entry as Record<string, unknown>
        const nested = e['hooks'] as unknown[]
        return (
          Array.isArray(nested) &&
          nested.some((h) => (h as Record<string, unknown>)['url'] === HOOK_URL)
        )
      })
      expect(hasOurUrl).toBe(true)
    }
  })

  it('idempotent: running twice results in exactly one hook entry per event (deduped by HOOK_URL)', () => {
    const dir = makeTempDir()
    const path = settingsFile(dir)
    const log = vi.fn<(msg: string) => void>()

    registerHooks({ projectDir: dir, log })
    registerHooks({ projectDir: dir, log })

    const parsed = readSettings(path) as Record<string, unknown>
    const hooks = parsed['hooks'] as Record<string, unknown>
    // Notification merges idempotently like every other registered event.
    expect(hooks['Notification']).toBeDefined()
    for (const eventName of REGISTERED_EVENTS) {
      const arr = hooks[eventName] as unknown[]
      // Count occurrences of our HOOK_URL in this event's hook list
      let count = 0
      for (const entry of arr) {
        const e = entry as Record<string, unknown>
        const nested = e['hooks'] as unknown[]
        if (Array.isArray(nested)) {
          for (const h of nested) {
            if ((h as Record<string, unknown>)['url'] === HOOK_URL) count++
          }
        }
        if ((e as Record<string, unknown>)['url'] === HOOK_URL) count++
      }
      expect(count).toBe(1)
    }
  })

  it('preserves existing hooks from other apps/tools (does not clobber them)', () => {
    const dir = makeTempDir()
    const log = vi.fn<(msg: string) => void>()

    // Pre-populate with an existing hook for UserPromptSubmit
    const path = seedSettings(dir, {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9999/' }] }]
      }
    })

    registerHooks({ projectDir: dir, log })

    const parsed = readSettings(path) as Record<string, unknown>
    const hooks = parsed['hooks'] as Record<string, unknown>
    const userPromptArr = hooks['UserPromptSubmit'] as unknown[]

    // The existing hook must still be present
    const hasExisting = userPromptArr.some((entry) => {
      const e = entry as Record<string, unknown>
      const nested = e['hooks'] as unknown[]
      return (
        Array.isArray(nested) &&
        nested.some((h) => (h as Record<string, unknown>)['url'] === 'http://127.0.0.1:9999/')
      )
    })
    expect(hasExisting).toBe(true)

    // Our hook must also be present
    const hasOurs = userPromptArr.some((entry) => {
      const e = entry as Record<string, unknown>
      const nested = e['hooks'] as unknown[]
      return (
        Array.isArray(nested) &&
        nested.some((h) => (h as Record<string, unknown>)['url'] === HOOK_URL)
      )
    })
    expect(hasOurs).toBe(true)
  })

  it('corrupt settings → backs up the bad file + skips (does not clobber with defaults)', () => {
    const dir = makeTempDir()
    const log = vi.fn<(msg: string) => void>()

    // Write corrupt JSON
    const path = seedSettings(dir, '{ this is not valid json }')

    registerHooks({ projectDir: dir, log })

    // The original file should have been renamed (backed up) — it must not exist at path anymore
    // OR a .bak was created. Either way, a corrupt-backed-up log must have been emitted.
    const logMessages = log.mock.calls.map(([m]) => m).join('\n')
    expect(logMessages).toContain('code=settings_corrupt_backed_up')

    // The original path must NOT contain defaults (we never clobber corrupt user files)
    // It may not exist (renamed) or it may be the backup
    if (existsSync(path)) {
      // If it still exists, it should not be valid JSON with our hooks
      try {
        const content = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
        // If it IS valid JSON now, it should NOT have our hook (we skipped)
        const hooks = content['hooks'] as Record<string, unknown> | undefined
        if (hooks !== undefined) {
          // We should not have written our hook
          for (const eventName of REGISTERED_EVENTS) {
            const arr = hooks[eventName]
            if (arr !== undefined) {
              // Unexpected — registerHooks should have skipped
              expect(false).toBe(true)
            }
          }
        }
      } catch {
        // Still corrupt — that's fine (it was a backup rename)
      }
    }
    // Clean up test temp dir
    rmSync(dir, { recursive: true, force: true })
  })

  it('no write when content is unchanged (idempotent skip)', () => {
    const dir = makeTempDir()
    const path = settingsFile(dir)
    const log = vi.fn<(msg: string) => void>()

    // First call: creates the file
    registerHooks({ projectDir: dir, log })
    const contentAfterFirst = readFileSync(path, 'utf8')

    // Second call: idempotent — content should be unchanged
    registerHooks({ projectDir: dir, log })
    const contentAfterSecond = readFileSync(path, 'utf8')

    expect(contentAfterFirst).toBe(contentAfterSecond)
    // No backup warnings on idempotent runs
    expect(log).not.toHaveBeenCalled()
    rmSync(dir, { recursive: true, force: true })
  })

  it('takes a .bak backup before the first real write (when file existed before)', () => {
    const dir = makeTempDir()
    const log = vi.fn<(msg: string) => void>()

    // Pre-populate with a valid settings file that needs merging
    const path = seedSettings(dir, { someOtherSetting: true })

    registerHooks({ projectDir: dir, log })

    // A .bak file should have been created
    expect(existsSync(path + '.bak')).toBe(true)
    // The .bak content should be the original
    const bakContent = JSON.parse(readFileSync(path + '.bak', 'utf8')) as Record<string, unknown>
    expect(bakContent['someOtherSetting']).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Claude Code reads `settings.local.json` from the REPOSITORY ROOT, not from the cwd
// (https://code.claude.com/docs/en/settings). If we wrote to the picked subdirectory instead,
// claude would read the repo root's file, never see our hooks, and the board card would sit at
// `Connecting` forever. These tests pin that resolution.
describe('resolveSettingsDir — the dir whose .claude/ claude actually reads', () => {
  it('outside a git repo: the picked dir itself (the documented exception)', () => {
    const dir = makeTempDir()
    expect(resolveSettingsDir(dir)).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it('inside a repo: walks UP to the repo root, not the picked subdirectory', () => {
    const root = makeTempDir()
    mkdirSync(join(root, '.git'), { recursive: true })
    const nested = join(root, 'services', 'api')
    mkdirSync(nested, { recursive: true })

    expect(resolveSettingsDir(nested)).toBe(root)
    // ...and the merge therefore lands at the ROOT, with no stray .claude/ in the subdir.
    registerHooks({ projectDir: nested, log: vi.fn<(msg: string) => void>() })
    expect(existsSync(join(root, '.claude', 'settings.local.json'))).toBe(true)
    expect(existsSync(join(nested, '.claude'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('linked worktree (.git is a FILE): resolves to the main checkout', () => {
    const main = makeTempDir()
    mkdirSync(join(main, '.git', 'worktrees', 'feat'), { recursive: true })
    const worktree = makeTempDir()
    writeFileSync(
      join(worktree, '.git'),
      `gitdir: ${join(main, '.git', 'worktrees', 'feat')}\n`,
      'utf8'
    )

    expect(resolveSettingsDir(worktree)).toBe(main)
    rmSync(main, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  })

  it('a malformed .git pointer file falls back to that dir (never throws)', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, '.git'), 'not a gitdir pointer', 'utf8')
    expect(resolveSettingsDir(dir)).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it('repo root === $HOME: falls back to the picked dir (never writes ~/.claude/)', () => {
    // $HOME is a git repo in some setups (dotfiles). Without the exception, launching in any
    // subfolder of home would scatter the hook block into the user's home settings.
    const fakeHome = makeTempDir()
    mkdirSync(join(fakeHome, '.git'), { recursive: true })
    const nested = join(fakeHome, 'work', 'thing')
    mkdirSync(nested, { recursive: true })

    const realHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      expect(resolveSettingsDir(nested)).toBe(nested)
    } finally {
      if (realHome === undefined) delete process.env.HOME
      else process.env.HOME = realHome
    }
    rmSync(fakeHome, { recursive: true, force: true })
  })

  it('projectSettingsPath is repo-root-resolved and targets settings.local.json', () => {
    const root = makeTempDir()
    mkdirSync(join(root, '.git'), { recursive: true })
    const nested = join(root, 'sub')
    mkdirSync(nested, { recursive: true })

    expect(projectSettingsPath(nested)).toBe(join(root, '.claude', 'settings.local.json'))
    rmSync(root, { recursive: true, force: true })
  })
})
