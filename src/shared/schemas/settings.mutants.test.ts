// Settings bounds the mutation run (StrykerJS) showed no test pinned: each per-key map accepts
// exactly its cap.
import { describe, it, expect } from 'vitest'
import {
  WallpaperByThemeSchema,
  WALLPAPER_BY_THEME_MAX,
  ShowAllTagsByWorkspaceSchema,
  SHOW_ALL_TAGS_MAX
} from './settings'

describe('per-key settings maps', () => {
  it('accepts exactly the cap of wallpaper picks', () => {
    const picks = Object.fromEntries(
      Array.from({ length: WALLPAPER_BY_THEME_MAX }, (_, i) => [`theme-${i}`, 'dawn'])
    )
    expect(WallpaperByThemeSchema.safeParse(picks).success).toBe(true)
  })

  it('accepts exactly the cap of show-all-tags workspaces', () => {
    const on = Object.fromEntries(
      Array.from({ length: SHOW_ALL_TAGS_MAX }, (_, i) => [`ws-${i}`, true])
    )
    expect(ShowAllTagsByWorkspaceSchema.safeParse(on).success).toBe(true)
  })
})
