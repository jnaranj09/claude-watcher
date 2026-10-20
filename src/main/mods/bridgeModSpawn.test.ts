// The spawn's one decision about the bridge mod: pass `--plugin-dir` and the report URL, or say
// why not. Every "not" is fail open: the launch goes on without the mod (spec 2026-10-18 §1.1).
import { describe, it, expect, vi } from 'vitest'
import { applyBridgeMod, bridgeModSpawn } from './bridgeModSpawn'
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

describe('applyBridgeMod (the spawn wiring)', () => {
  function deps(listening: boolean): Parameters<typeof applyBridgeMod>[0] & {
    env: Record<string, string>
    onSkip: ReturnType<typeof vi.fn<(id: string, reason: string) => void>>
  } {
    return {
      sessionId: 'sid',
      env: { PATH: '/bin' },
      listening: () => listening,
      installedDir: () => DIR,
      version: () => ({ major: 9, minor: 0, patch: 0 }),
      hookPort: 19279,
      onSkip: vi.fn<(id: string, reason: string) => void>(),
      log: () => {}
    }
  }

  it('sets the report URL in the env and returns the mod folder when the mod can run', () => {
    const d = deps(true)
    expect(applyBridgeMod(d)).toBe(DIR)
    expect(d.env.CLAUDE_WATCHER_MOD_URL).toBe('http://127.0.0.1:19279/mod/report')
    expect(d.onSkip).not.toHaveBeenCalled()
  })

  it('reads the port bind at spawn time: not bound → no URL in the env, no folder, onSkip', () => {
    const d = deps(false)
    expect(applyBridgeMod(d)).toBeNull()
    expect(d.env).not.toHaveProperty('CLAUDE_WATCHER_MOD_URL')
    expect(d.onSkip).toHaveBeenCalledWith('sid', 'listener_down')
  })
})
