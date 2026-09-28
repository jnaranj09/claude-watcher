// Zero-footprint hook delivery — the `--settings` file the app hands to every claude it spawns.
//
// What these tests are actually protecting: the app used to write its hook block into the
// LAUNCHED PROJECT's `.claude/settings.local.json`. This module replaced that, so the two
// things worth guarding are (a) the file still contains a block claude will accept, and
// (b) writing it can never fail a launch.
import { describe, it, expect, vi, type Mock } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildHookSettings,
  ensureHookSettingsFile,
  hookSettingsPathIfListening,
  HOOK_SETTINGS_FILENAME,
  type HookSettingsForSpawnDeps
} from './hookSettingsFile'
import { HOOK_URL, REGISTERED_EVENTS } from './hookContract'

const freshDir = (): string => mkdtempSync(join(tmpdir(), 'c9-hooksettings-'))

describe('buildHookSettings', () => {
  it('registers EVERY contract event against the loopback listener', () => {
    const settings = buildHookSettings()

    expect(Object.keys(settings.hooks).sort()).toEqual([...REGISTERED_EVENTS].sort())
    for (const eventName of REGISTERED_EVENTS) {
      expect(settings.hooks[eventName]).toEqual([{ hooks: [{ type: 'http', url: HOOK_URL }] }])
    }
  })

  it('carries UserPromptSubmit — the event name-sync rides on', () => {
    // The rename push is delivered by ANSWERING a UserPromptSubmit POST, and the read-back
    // reads `session_title` off the same event. Drop it from the block and the card and
    // claude's own name silently stop converging, with nothing else failing.
    expect(buildHookSettings().hooks['UserPromptSubmit']).toBeDefined()
  })

  it('points at the loopback URL only — never a routable address', () => {
    const serialized = JSON.stringify(buildHookSettings())

    expect(serialized).toContain('127.0.0.1')
    expect(serialized).not.toContain('0.0.0.0')
  })
})

describe('ensureHookSettingsFile', () => {
  it('writes a file claude can parse, and returns its path', () => {
    const dir = freshDir()

    const path = ensureHookSettingsFile({ dir })

    expect(path).toBe(join(dir, HOOK_SETTINGS_FILENAME))
    expect(JSON.parse(readFileSync(path as string, 'utf8'))).toEqual(buildHookSettings())
  })

  it('creates the data dir when it does not exist yet (first ever launch)', () => {
    const dir = join(freshDir(), 'nested', 'userData')

    const path = ensureHookSettingsFile({ dir })

    expect(path).not.toBeNull()
    expect(existsSync(path as string)).toBe(true)
  })

  it('SELF-HEALS a deleted or hand-edited file on the next launch', () => {
    // The whole reason this runs per spawn instead of once at startup. If it only ran at
    // startup, a file removed mid-session would leave every later launch with no hooks and
    // no status, until the app was restarted.
    const dir = freshDir()
    const path = ensureHookSettingsFile({ dir }) as string
    writeFileSync(path, '{"hooks":{}}', 'utf8') // operator/tool clobbered it

    ensureHookSettingsFile({ dir })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(buildHookSettings())
  })

  it('is idempotent — a second call leaves identical content', () => {
    const dir = freshDir()

    const first = ensureHookSettingsFile({ dir }) as string
    const afterFirst = readFileSync(first, 'utf8')
    const second = ensureHookSettingsFile({ dir })

    expect(second).toBe(first)
    expect(readFileSync(first, 'utf8')).toBe(afterFirst)
  })

  it('writes ONLY inside the given dir — it must never reach into a project', () => {
    // The bug this whole change exists to remove: the retired merger wrote into whatever
    // project the operator launched in. The path must stay anchored to the app's own dir.
    const dir = freshDir()

    const path = ensureHookSettingsFile({ dir }) as string

    expect(path.startsWith(dir)).toBe(true)
    expect(path).not.toContain('.claude')
  })

  describe('fail-soft (never-crash)', () => {
    it('returns null instead of throwing when the dir cannot be written', () => {
      const parent = freshDir()
      const dir = join(parent, 'readonly')
      mkdirSync(dir)
      chmodSync(dir, 0o500) // r-x: cannot create files inside

      let result: string | null = 'unset'
      expect(() => {
        result = ensureHookSettingsFile({ dir, log: vi.fn<(msg: string) => void>() })
      }).not.toThrow()

      // Root ignores the mode bits, so only assert the contract when the write really failed.
      if (result !== null) {
        expect(existsSync(result)).toBe(true)
      } else {
        expect(result).toBeNull()
      }
      chmodSync(dir, 0o700)
    })

    it('logs a CODE only — never the path (it leaks the filesystem layout)', () => {
      const parent = freshDir()
      const dir = join(parent, 'readonly2')
      mkdirSync(dir)
      chmodSync(dir, 0o500)
      const log = vi.fn<(msg: string) => void>()

      const result = ensureHookSettingsFile({ dir, log })

      if (result === null) {
        expect(log).toHaveBeenCalledTimes(1)
        const msg = log.mock.calls[0]?.[0] ?? ''
        expect(msg).toContain('code=')
        expect(msg).not.toContain(dir)
        expect(msg).not.toContain(parent)
      }
      chmodSync(dir, 0o700)
    })

    it('does not throw when no log sink is supplied at all', () => {
      const parent = freshDir()
      const dir = join(parent, 'readonly3')
      mkdirSync(dir)
      chmodSync(dir, 0o500)

      expect(() => ensureHookSettingsFile({ dir })).not.toThrow()
      chmodSync(dir, 0o700)
    })
  })
})

describe('hookSettingsPathIfListening (SEC-6)', () => {
  function deps(
    listening: boolean,
    ensure: () => string | null = () => '/data/hooks.json'
  ): {
    logs: string[]
    written: boolean[]
    ensureSpy: Mock<() => string | null>
    deps: HookSettingsForSpawnDeps
  } {
    const logs: string[] = []
    const written: boolean[] = []
    const ensureSpy = vi.fn<() => string | null>(ensure)
    return {
      logs,
      written,
      ensureSpy,
      deps: {
        listening: () => listening,
        ensure: ensureSpy,
        written: (ok: boolean) => void written.push(ok),
        log: (m: string) => void logs.push(m)
      }
    }
  }

  it('NOT listening → null, no file write, one code line (a squatter gets no hooks)', () => {
    const d = deps(false)
    expect(hookSettingsPathIfListening(d.deps)).toBeNull()
    expect(d.ensureSpy).not.toHaveBeenCalled()
    expect(d.logs).toEqual(['[c9watch][hookSettings] code=hook_server_not_listening'])
  })

  it('listening → the written path, and reports the write worked', () => {
    const d = deps(true)
    expect(hookSettingsPathIfListening(d.deps)).toBe('/data/hooks.json')
    expect(d.written).toEqual([true])
    expect(d.logs).toEqual([])
  })

  it('listening but the write fails → null, reported as failed', () => {
    const d = deps(true, () => null)
    expect(hookSettingsPathIfListening(d.deps)).toBeNull()
    expect(d.written).toEqual([false])
  })

  it('a throwing write is contained and logged by code only', () => {
    const d = deps(true, () => {
      throw new Error('EACCES /home/someone/.config/claude-watcher')
    })
    expect(hookSettingsPathIfListening(d.deps)).toBeNull()
    expect(d.written).toEqual([false])
    expect(d.logs).toEqual(['[c9watch][hookSettings] code=hook_settings_unavailable'])
  })
})
