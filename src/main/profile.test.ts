import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, DEV_PROFILE, DRIVE_PROFILE, resolveProfile } from './profile'

describe('resolveProfile', () => {
  it('is dev only while electron-vite dev serves the renderer', () => {
    expect(resolveProfile({ ELECTRON_RENDERER_URL: 'http://localhost:5173' })).toBe(DEV_PROFILE)
  })

  it('is default for a packaged or built run (no renderer URL, or an empty one)', () => {
    expect(resolveProfile({})).toBe(DEFAULT_PROFILE)
    expect(resolveProfile({ ELECTRON_RENDERER_URL: '' })).toBe(DEFAULT_PROFILE)
  })

  it('is drive only when CLAUDE_WATCHER_PROFILE=drive asks for it, even beside a renderer URL', () => {
    expect(resolveProfile({ CLAUDE_WATCHER_PROFILE: 'drive' })).toBe(DRIVE_PROFILE)
    expect(
      resolveProfile({ CLAUDE_WATCHER_PROFILE: 'drive', ELECTRON_RENDERER_URL: 'http://x' })
    ).toBe(DRIVE_PROFILE)
  })

  it('ignores any other CLAUDE_WATCHER_PROFILE value (no way to pick dev or default by name)', () => {
    expect(resolveProfile({ CLAUDE_WATCHER_PROFILE: 'dev' })).toBe(DEFAULT_PROFILE)
    expect(resolveProfile({ CLAUDE_WATCHER_PROFILE: 'Drive' })).toBe(DEFAULT_PROFILE)
    expect(resolveProfile({ CLAUDE_WATCHER_PROFILE: '' })).toBe(DEFAULT_PROFILE)
  })

  it('no two profiles share a data dir or a port, and none takes 9280', () => {
    const all = [DEFAULT_PROFILE, DEV_PROFILE, DRIVE_PROFILE]
    expect(new Set(all.map((p) => p.userDataDirName)).size).toBe(all.length)
    const ports = all.flatMap((p) => [p.hookPort, p.apiPort])
    expect(new Set(ports).size).toBe(ports.length)
    expect(ports).not.toContain(9280)
  })
})
