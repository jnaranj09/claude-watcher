import { describe, it, expect } from 'vitest'
import { chosenWallpaper, themeNeedsReapply } from './themeApplyTrigger'

const s = (
  themeId: string,
  wallpaperByTheme: Record<string, string> = {}
): { themeId: string; wallpaperByTheme: Record<string, string> } => ({
  themeId,
  wallpaperByTheme
})

describe('chosenWallpaper', () => {
  it('reads the pick for the chosen theme only', () => {
    expect(chosenWallpaper(s('g', { g: 'a', h: 'b' }))).toBe('a')
    expect(chosenWallpaper(s('x', { g: 'a' }))).toBeUndefined()
  })
})

describe('themeNeedsReapply', () => {
  it('true when the theme changes', () => {
    expect(themeNeedsReapply(s('g'), s('h'))).toBe(true)
  })
  it("true when the chosen theme's pick changes", () => {
    expect(themeNeedsReapply(s('g', { g: 'a' }), s('g', { g: 'b' }))).toBe(true)
    expect(themeNeedsReapply(s('g'), s('g', { g: 'a' }))).toBe(true)
  })
  it("false when nothing theme-related changed, or only ANOTHER theme's pick changed", () => {
    expect(themeNeedsReapply(s('g', { g: 'a' }), s('g', { g: 'a' }))).toBe(false)
    expect(themeNeedsReapply(s('g', { g: 'a' }), s('g', { g: 'a', h: 'z' }))).toBe(false)
  })
})
