// Theme wallpapers (spec 2026-09-24) — WHEN main re-applies the theme. Pure, so the settings
// handler (ipc/registerStoreIpc.ts) stays one line and a font-size patch provably re-reads nothing.
import type { Settings } from '../../shared/schemas/settings'

type ThemeChoice = Pick<Settings, 'themeId' | 'wallpaperByTheme'>

/** The operator's wallpaper pick for the CHOSEN theme, if any. */
export function chosenWallpaper(s: ThemeChoice): string | undefined {
  return s.wallpaperByTheme[s.themeId]
}

/** True when the chosen theme or ITS wallpaper pick changed. */
export function themeNeedsReapply(before: ThemeChoice, next: ThemeChoice): boolean {
  return before.themeId !== next.themeId || chosenWallpaper(before) !== chosenWallpaper(next)
}
