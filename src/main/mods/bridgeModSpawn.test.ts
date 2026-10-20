// The spawn's one decision about the bridge mod: pass `--plugin-dir` and the report URL, or say
// why not. Every "not" is fail open: the launch goes on without the mod (spec 2026-10-18 §1.1).
import { describe, it, expect, vi } from 'vitest'
import { bridgeModSpawn } from './bridgeModSpawn'
import { MIN_MOD_CLAUDE_VERSION } from '../../shared/launch/claudeVersion'

const DIR = '/data/mods/watcher-bridge'
const ok = {
  version: { major: 9, minor: 0, patch: 0 },
  listening: true,
  installedDir: DIR,
  hookPort: 19279
}

describe('bridgeModSpawn', () => {
  it('gives the mod folder and the report URL on the hook port when everything is in place', () => {
    expect(bridgeModSpawn(ok, () => {})).toEqual({
      pluginDir: DIR,
      env: { CLAUDE_WATCHER_MOD_URL: 'http://127.0.0.1:19279/mod/report' }
    })
  })

  it('skips with listener_down when the hook listener is not bound', () => {
    expect(bridgeModSpawn({ ...ok, listening: false }, () => {})).toEqual({
      skip: 'listener_down'
    })
  })

  it('skips with mod_not_installed when the mod folder was not written', () => {
    expect(bridgeModSpawn({ ...ok, installedDir: null }, () => {})).toEqual({
      skip: 'mod_not_installed'
    })
  })

  it('skips with claude_too_old when claude is below the mod floor', () => {
    const below = { ...MIN_MOD_CLAUDE_VERSION, patch: MIN_MOD_CLAUDE_VERSION.patch - 1 }
    expect(bridgeModSpawn({ ...ok, version: below }, () => {})).toEqual({
      skip: 'claude_too_old'
    })
  })

  it('skips with claude_too_old and logs mod_skipped_version when the version is unknown', () => {
    const log = vi.fn<(line: string) => void>()
    expect(bridgeModSpawn({ ...ok, version: null }, log)).toEqual({ skip: 'claude_too_old' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][mods] code=mod_skipped_version')
  })

  it('runs the mod on exactly the floor version', () => {
    expect(bridgeModSpawn({ ...ok, version: MIN_MOD_CLAUDE_VERSION }, () => {})).toHaveProperty(
      'pluginDir',
      DIR
    )
  })
})
