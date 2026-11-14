// Each spawn's choice between the memory mod (recall while the session runs) and the launch index
// only (memory phase 3, addendum §2): the `Memory recall` setting, the installed folder and the
// claude version, read at each spawn, in that order.
import { beforeEach, describe, expect, it } from 'vitest'
import type { ClaudeVersion } from '../../shared/launch/claudeVersion'
import { createMemoryModChoice } from './memoryModSpawn'

const V = (patch: number, minor = 1): ClaudeVersion => ({ major: 2, minor, patch })
const DIR = '/data/mods/watcher-memory'

let lines: string[]
beforeEach(() => {
  lines = []
})

const choice = (
  over: Partial<{
    enabled: boolean
    dir: string | null
    exists: boolean
    version: ClaudeVersion | null
  }>
): ReturnType<ReturnType<typeof createMemoryModChoice>> =>
  createMemoryModChoice({
    settings: () => ({ memoryRecallEnabled: over.enabled ?? true }),
    installedDir: () => ('dir' in over ? (over.dir ?? null) : DIR),
    exists: () => over.exists ?? true,
    version: () => ('version' in over ? (over.version ?? null) : V(323)),
    log: (l) => lines.push(l)
  })()

describe('createMemoryModChoice', () => {
  it('gives the folder at the floor and above it', () => {
    expect([choice({}), choice({ version: V(0, 2) })]).toEqual([{ dir: DIR }, { dir: DIR }])
  })

  it('says why not, checking the setting first, then the install, then the version', () => {
    expect([
      choice({ enabled: false, dir: null, version: null }),
      choice({ dir: null, version: null }),
      choice({ version: V(322) })
    ]).toEqual([{ skip: 'setting_off' }, { skip: 'mod_not_installed' }, { skip: 'claude_too_old' }])
    expect(lines).toEqual([])
  })

  it('an installed folder that is gone at launch counts as not installed', () => {
    expect(choice({ exists: false, version: null })).toEqual({ skip: 'mod_not_installed' })
    expect(lines).toEqual([])
  })

  it('an unknown version skips and logs a code', () => {
    expect(choice({ version: null })).toEqual({ skip: 'claude_too_old' })
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_mod_skipped_version'])
  })

  it('reads the setting, the folder and the version at each spawn', () => {
    let enabled = false
    let dir: string | null = null
    let version: ClaudeVersion | null = null
    const choose = createMemoryModChoice({
      settings: () => ({ memoryRecallEnabled: enabled }),
      installedDir: () => dir,
      exists: () => true,
      version: () => version,
      log: (l) => lines.push(l)
    })
    const first = choose()
    enabled = true
    dir = DIR
    version = V(323)
    expect([first, choose()]).toEqual([{ skip: 'setting_off' }, { dir: DIR }])
  })

  it('asks whether the installed folder is there, at each spawn', () => {
    const asked: string[] = []
    const choose = createMemoryModChoice({
      settings: () => ({ memoryRecallEnabled: true }),
      installedDir: () => DIR,
      exists: (dir) => {
        asked.push(dir)
        return asked.length > 1
      },
      version: () => V(323),
      log: (l) => lines.push(l)
    })
    expect([choose(), choose(), asked]).toEqual([
      { skip: 'mod_not_installed' },
      { dir: DIR },
      [DIR, DIR]
    ])
  })
})
