// The installed mod folders main reads at each spawn: each getter answers its own mod's folder.
import { describe, expect, it } from 'vitest'
import { createModDirs } from './modDirs'

describe('createModDirs', () => {
  it('answers null for both mods before the install answered', () => {
    const dirs = createModDirs()
    expect([dirs.bridge(), dirs.memory()]).toEqual([null, null])
  })

  it('each getter answers its own mod’s folder, never the other’s', () => {
    const dirs = createModDirs()
    dirs.set({ bridge: '/data/mods/watcher-bridge', memory: '/data/mods/watcher-memory' })
    expect([dirs.bridge(), dirs.memory()]).toEqual([
      '/data/mods/watcher-bridge',
      '/data/mods/watcher-memory'
    ])
  })

  it('a failed memory install leaves the bridge folder and no memory folder', () => {
    const dirs = createModDirs()
    dirs.set({ bridge: '/data/mods/watcher-bridge', memory: null })
    expect([dirs.bridge(), dirs.memory()]).toEqual(['/data/mods/watcher-bridge', null])
  })
})
