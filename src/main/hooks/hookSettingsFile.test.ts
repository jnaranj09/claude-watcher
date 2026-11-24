// Zero-footprint hook delivery — the `--settings` file the app hands to every claude it spawns.
//
// What these tests are actually protecting: the app used to write its hook block into the
// LAUNCHED PROJECT's `.claude/settings.local.json`. This module replaced that, so the things
// worth guarding are (a) the file still contains a block claude will accept, (b) writing it can
// never fail a launch, and (c) the file is the session's own and private: its URL holds the
// session's hook channel token (T-D13), so nobody else may read it and it never names it.
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildHookSettings,
  createHookSettingsFiles,
  hookSettingsPathIfListening,
  removeLegacyHookSettings,
  type HookSettingsForSpawnDeps
} from './hookSettingsFile'
import { REGISTERED_EVENTS } from './hookContract'

const URL_A = 'http://127.0.0.1:19279/h/aaaa/'
const TOKEN = 'b'.repeat(64)

const tempDirs: string[] = []
const freshDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'c9-hooksettings-'))
  tempDirs.push(d)
  return d
}
// Read-only dirs are tracked so the afterEach can make them writable again even when an assertion
// failed first; a 0o500 dir cannot be removed (or have its parent removed) otherwise.
const readonlyDirs: string[] = []
afterEach(() => {
  for (const d of readonlyDirs.splice(0)) chmodSync(d, 0o700)
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('buildHookSettings', () => {
  it('registers EVERY contract event against the loopback listener', () => {
    const settings = buildHookSettings(URL_A)

    expect(Object.keys(settings.hooks).sort()).toEqual([...REGISTERED_EVENTS].sort())
    for (const eventName of REGISTERED_EVENTS) {
      expect(settings.hooks[eventName]).toEqual([{ hooks: [{ type: 'http', url: URL_A }] }])
    }
  })

  it('carries UserPromptSubmit — the event name-sync rides on', () => {
    // The rename push is delivered by ANSWERING a UserPromptSubmit POST, and the read-back
    // reads `session_title` off the same event. Drop it from the block and the card and
    // claude's own name silently stop converging, with nothing else failing.
    expect(buildHookSettings(URL_A).hooks['UserPromptSubmit']).toBeDefined()
  })

  it('carries StopFailure — the only turn end an API error sends (ST-3)', () => {
    // Rate limit / overload / network / bad model end the turn with StopFailure and NO Stop.
    // Drop it from the block and the card stays Working forever with no alert.
    expect(buildHookSettings(URL_A).hooks['StopFailure']).toBeDefined()
  })

  it.each(['SessionStart', 'Setup'])(
    'does NOT register %s — claude refuses http hooks for it (ST-7)',
    (eventName) => {
      // claude 2.1.289 drops an http hook for these two events before running it ("HTTP hooks
      // are not supported for SessionStart"). Registering one only pretends a mapping works.
      expect(buildHookSettings(URL_A).hooks[eventName]).toBeUndefined()
    }
  )

  it('carries SessionEnd — the only event a /clear sends (ST-7)', () => {
    // `SessionEnd reason:"clear"` for the old id is how the card learns of a /clear.
    expect(buildHookSettings(URL_A).hooks['SessionEnd']).toBeDefined()
  })

  it('carries PermissionRequest — the instant a permission dialog opens (ST-5)', () => {
    // Notification(permission_prompt) comes 6 s after the dialog. Drop PermissionRequest from
    // the block and the card says Working for those 6 s while claude waits on the operator.
    expect(buildHookSettings(URL_A).hooks['PermissionRequest']).toBeDefined()
  })

  it('carries PostToolUseFailure — an approved tool that fails ends with it, not PostToolUse (ST-1)', () => {
    // A prompt answered by click is cleared only by its own tool finishing. A failing tool sends
    // PostToolUseFailure instead of PostToolUse; drop it and that card stays needs-you all turn.
    expect(buildHookSettings(URL_A).hooks['PostToolUseFailure']).toBeDefined()
  })

  it.each(['Elicitation', 'ElicitationResult'])(
    'carries %s — an MCP server asking for input opens and closes the wait (ST-6)',
    (eventName) => {
      // Elicitation fires the instant an MCP server asks (its Notification comes 6 s later);
      // ElicitationResult is the only event after the operator answers the form.
      expect(buildHookSettings(URL_A).hooks[eventName]).toBeDefined()
    }
  )

  it.each(['PreCompact', 'PostCompact'])(
    'carries %s — the only events a manual /compact sends (ST-8)',
    (eventName) => {
      // Probe S11: /compact sends these two and nothing else. Drop them and the card keeps its
      // old status while claude compacts.
      expect(buildHookSettings(URL_A).hooks[eventName]).toBeDefined()
    }
  )
})

describe('createHookSettingsFiles', () => {
  const files = (
    dir: string,
    log: (line: string) => void = () => {}
  ): ReturnType<typeof createHookSettingsFiles> =>
    createHookSettingsFiles({ dir: () => dir, log, port: 19279 })

  it("writes a file claude can parse, its every hook on the loopback channel URL with the session's token", () => {
    const dir = freshDir()

    const path = files(dir).write('s1', TOKEN)

    expect(JSON.parse(readFileSync(path as string, 'utf8'))).toEqual(
      buildHookSettings(`http://127.0.0.1:19279/h/${TOKEN}/`)
    )
  })

  it('creates the data dir when it does not exist yet (first ever launch)', () => {
    const dir = join(freshDir(), 'nested', 'userData')

    const path = files(dir).write('s1', TOKEN)

    expect(existsSync(path as string)).toBe(true)
  })

  it('keeps the file private: folder 0700 (an existing one is tightened), file 0600, the token not in its path', () => {
    const dir = freshDir()
    mkdirSync(join(dir, 'hooks'), { mode: 0o755 })

    const path = files(dir).write('s1', TOKEN) as string

    expect([
      statSync(join(dir, 'hooks')).mode & 0o777,
      statSync(path).mode & 0o777,
      path.includes(TOKEN)
    ]).toEqual([0o700, 0o600, false])
  })

  it('writes ONLY inside the given dir — it must never reach into a project', () => {
    // The bug this whole change exists to remove: the retired merger wrote into whatever
    // project the operator launched in. The path must stay anchored to the app's own dir.
    const dir = freshDir()

    const path = files(dir).write('s1', TOKEN) as string

    expect(path.startsWith(join(dir, 'hooks'))).toBe(true)
    expect(path).not.toContain('.claude')
  })

  it("gives each session its own file, and a session's next write replaces its old one", () => {
    const dir = freshDir()
    const f = files(dir)
    const a1 = f.write('a', TOKEN) as string
    const b = f.write('b', 'c'.repeat(64)) as string
    const a2 = f.write('a', 'd'.repeat(64)) as string

    expect([a1 === b, existsSync(a1), existsSync(b), existsSync(a2)]).toEqual([
      false,
      false,
      true,
      true
    ])
  })

  it('a /clear moves the file to the new id, and removing the new id deletes it', () => {
    const dir = freshDir()
    const f = files(dir)
    const path = f.write('old', TOKEN) as string
    f.rebind('old', 'new')
    f.remove('old')
    const keptAfterOld = existsSync(path)
    f.remove('new')

    expect([keptAfterOld, existsSync(path)]).toEqual([true, false])
  })

  it('a start clears every file a previous run left', () => {
    const dir = freshDir()
    const leftover = files(dir).write('s1', TOKEN) as string

    files(dir).clearStale()

    expect([existsSync(leftover), readdirSync(join(dir, 'hooks'))]).toEqual([false, []])
  })

  it('removeLegacyHookSettings deletes the shared file earlier builds wrote, and is fine when it is gone', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'claude-hooks.settings.json'), '{}')

    removeLegacyHookSettings(dir, () => {})
    removeLegacyHookSettings(dir, () => {})

    expect(readdirSync(dir)).toEqual([])
  })

  describe('fail-soft (never-crash)', () => {
    // Root ignores the mode bits, so the write succeeds there and the contract cannot be observed.
    const IS_ROOT = process.getuid?.() === 0

    it.skipIf(IS_ROOT)('returns null instead of throwing when the dir cannot be written', () => {
      const parent = freshDir()
      const dir = join(parent, 'readonly')
      mkdirSync(dir)
      chmodSync(dir, 0o500) // r-x: cannot create files inside
      readonlyDirs.push(dir)

      let result: string | null = 'unset'
      expect(() => {
        result = files(dir).write('s1', TOKEN)
      }).not.toThrow()

      expect(result).toBeNull()
    })

    it.skipIf(IS_ROOT)(
      'logs a CODE only — never the path (it leaks the filesystem layout) or the token',
      () => {
        const parent = freshDir()
        const dir = join(parent, 'readonly2')
        mkdirSync(dir)
        chmodSync(dir, 0o500)
        readonlyDirs.push(dir)
        const log = vi.fn<(msg: string) => void>()

        const result = files(dir, log).write('s1', TOKEN)

        expect(result).toBeNull()
        expect(log.mock.calls).toEqual([
          ['[claude-watcher][hooks] code=hook_settings_write_failed']
        ])
      }
    )
  })
})

describe('hookSettingsPathIfListening (SEC-6)', () => {
  function deps(
    listening: boolean,
    ensure: (token: string) => string | null = () => '/data/hooks.json',
    token: string | null = TOKEN
  ): {
    logs: string[]
    written: boolean[]
    ensureSpy: Mock<(token: string) => string | null>
    deps: HookSettingsForSpawnDeps
  } {
    const logs: string[] = []
    const written: boolean[] = []
    const ensureSpy = vi.fn<(token: string) => string | null>(ensure)
    return {
      logs,
      written,
      ensureSpy,
      deps: {
        token,
        listening: () => listening,
        write: ensureSpy,
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

  it('no channel token (the port was not ours when it was minted) → null, no file write', () => {
    const d = deps(true, undefined, null)
    expect(hookSettingsPathIfListening(d.deps)).toBeNull()
    expect(d.ensureSpy).not.toHaveBeenCalled()
  })

  it("listening → the written path for the spawn's token, and reports the write worked", () => {
    const d = deps(true)
    expect(hookSettingsPathIfListening(d.deps)).toBe('/data/hooks.json')
    expect(d.ensureSpy).toHaveBeenCalledWith(TOKEN)
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
