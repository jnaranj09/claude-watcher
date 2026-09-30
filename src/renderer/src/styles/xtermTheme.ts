// The default xterm ITheme lives in src/shared/theme/xtermTheme.ts (the examples test in main
// compares a package against it). `xtermThemeFor` is what a live terminal applies: the default
// palette with the applied theme's terminal keys on top. `allowTransparency` is NOT an ITheme
// key — EmbeddedTerminal reads it at creation (xterm needs it before open()).
//
// Terminal colours (spec 2026-09-30): the operator's `terminalScheme` setting picks between
// following the theme and a built-in dark / light palette. The helpers below resolve it.
import type { ITheme } from '@xterm/xterm'
import { xtermTheme, xtermLightTheme } from '../../../shared/theme/xtermTheme'
import { TERMINAL_THEME_KEYS, type ThemeTerminal } from '../../../shared/schemas/theme'
import type { TerminalScheme } from '../../../shared/schemas/settings'

export { xtermTheme, xtermLightTheme }

export type TerminalKind = 'dark' | 'light'

/** The contrast floor a LIGHT terminal gets. claude's own (dark) theme draws light 24-bit colours
 *  that skip the ANSI palette; xterm raises each one at draw time until it reaches this ratio. */
const LIGHT_MIN_CONTRAST = 4.5

export function xtermThemeFor(terminal: ThemeTerminal, scheme: TerminalScheme = 'theme'): ITheme {
  if (scheme === 'dark') return { ...xtermTheme }
  if (scheme === 'light') return { ...xtermLightTheme }
  const out: ITheme = { ...xtermTheme }
  for (const key of TERMINAL_THEME_KEYS) {
    const value = terminal[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Whether the terminal ends up dark or light: under "theme" it is the applied theme's scheme. */
export function terminalKindFor(
  scheme: TerminalScheme,
  themeColorScheme: TerminalKind
): TerminalKind {
  return scheme === 'theme' ? themeColorScheme : scheme
}

/** xterm's `minimumContrastRatio`: the floor on light, xterm's default (1 = off) on dark. */
export function minimumContrastFor(kind: TerminalKind): number {
  return kind === 'light' ? LIGHT_MIN_CONTRAST : 1
}

/** The frame's inline `--bg-terminal` under a built-in palette, so a dark terminal inside a light
 *  theme has no light rim. Under "theme" the token rules (a see-through theme stays see-through). */
export function frameBackgroundFor(scheme: TerminalScheme): string | undefined {
  if (scheme === 'dark') return xtermTheme.background
  if (scheme === 'light') return xtermLightTheme.background
  return undefined
}
