import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, DEV_PROFILE, resolveProfile } from './profile'

describe('resolveProfile', () => {
  it('is dev only while electron-vite dev serves the renderer', () => {
    expect(resolveProfile({ ELECTRON_RENDERER_URL: 'http://localhost:5173' })).toBe(DEV_PROFILE)
  })

  it('is default for a packaged or built run (no renderer URL, or an empty one)', () => {
    expect(resolveProfile({})).toBe(DEFAULT_PROFILE)
    expect(resolveProfile({ ELECTRON_RENDERER_URL: '' })).toBe(DEFAULT_PROFILE)
  })

  it('shares no data dir and no port with the default profile', () => {
    expect(DEV_PROFILE.userDataDirName).not.toBe(DEFAULT_PROFILE.userDataDirName)
    const devPorts = [DEV_PROFILE.hookPort, DEV_PROFILE.apiPort]
    for (const port of [DEFAULT_PROFILE.hookPort, DEFAULT_PROFILE.apiPort, 9280]) {
      expect(devPorts).not.toContain(port)
    }
  })
})
