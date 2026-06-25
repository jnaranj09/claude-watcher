// Hook-status feature — unit tests for registerHooks.
//
// Runs under the `main-unit` Vitest project (node). Uses a temp file in the
// scratchpad directory (injected via settingsPath) — never touches the real
// ~/.claude/settings.json. [spec Tasks; spec registerHooks.ts Code Map]

import { describe, it, expect, vi } from 'vitest'
import { registerHooks } from './registerHooks'
import { HOOK_URL, REGISTERED_EVENTS } from './hookContract'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// Each test gets its own temp directory to avoid cross-test pollution.
function makeTempDir(): string {
  const dir = join(tmpdir(), `hook-reg-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function settingsFile(dir: string): string {
  return join(dir, 'settings.json')
}

function readSettings(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('registerHooks — idempotent merge into settings.json', () => {
  it('ENOENT: creates the file from {} with the hook block', () => {
    const dir = makeTempDir()
    const path = settingsFile(dir)
    expect(existsSync(path)).toBe(false)

    const log = vi.fn<(msg: string) => void>()
    registerHooks({ settingsPath: path, log })

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

    registerHooks({ settingsPath: path, log })
    registerHooks({ settingsPath: path, log })

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
    const path = settingsFile(dir)
    const log = vi.fn<(msg: string) => void>()

    // Pre-populate with an existing hook for UserPromptSubmit
    const existingSettings = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9999/' }] }]
      }
    }
    writeFileSync(path, JSON.stringify(existingSettings, null, 2), 'utf8')

    registerHooks({ settingsPath: path, log })

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
    const path = settingsFile(dir)
    const log = vi.fn<(msg: string) => void>()

    // Write corrupt JSON
    const corruptContent = '{ this is not valid json }'
    writeFileSync(path, corruptContent, 'utf8')

    registerHooks({ settingsPath: path, log })

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
    registerHooks({ settingsPath: path, log })
    const contentAfterFirst = readFileSync(path, 'utf8')

    // Second call: idempotent — content should be unchanged
    registerHooks({ settingsPath: path, log })
    const contentAfterSecond = readFileSync(path, 'utf8')

    expect(contentAfterFirst).toBe(contentAfterSecond)
    // No backup warnings on idempotent runs
    expect(log).not.toHaveBeenCalled()
    rmSync(dir, { recursive: true, force: true })
  })

  it('takes a .bak backup before the first real write (when file existed before)', () => {
    const dir = makeTempDir()
    const path = settingsFile(dir)
    const log = vi.fn<(msg: string) => void>()

    // Pre-populate with a valid settings file that needs merging
    const existing = { someOtherSetting: true }
    writeFileSync(path, JSON.stringify(existing, null, 2), 'utf8')

    registerHooks({ settingsPath: path, log })

    // A .bak file should have been created
    expect(existsSync(path + '.bak')).toBe(true)
    // The .bak content should be the original
    const bakContent = JSON.parse(readFileSync(path + '.bak', 'utf8')) as Record<string, unknown>
    expect(bakContent['someOtherSetting']).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the parent directory when it does not exist (atomic, dir-safe write)', () => {
    const dir = makeTempDir()
    // Point at a settings file inside a NOT-yet-existing subdirectory (e.g. fresh ~/.claude).
    const path = join(dir, 'missing-subdir', 'settings.json')
    expect(existsSync(path)).toBe(false)

    const log = vi.fn<(msg: string) => void>()
    registerHooks({ settingsPath: path, log })

    // The parent dir was created and the file written with our hook block; nothing logged.
    expect(existsSync(path)).toBe(true)
    expect(log).not.toHaveBeenCalled()
    const parsed = readSettings(path) as Record<string, unknown>
    expect(parsed['hooks']).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
