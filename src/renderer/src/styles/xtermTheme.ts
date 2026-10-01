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
 *  that skip the ANSI palette; xterm raises each one at draw time until it reaches this ratio.
 *  7 (AAA), not 4.5: at 4.5 claude's grey lines stayed a pale grey that read as faded (operator,
 *  2026-09-30). */
const LIGHT_MIN_CONTRAST = 7

/** The terminal font stack. A dark terminal draws Regular (400). */
export const TERMINAL_FONT_FAMILY =
  "'JetBrains Mono', ui-monospace, 'Hack', 'Noto Sans Mono', monospace"

/** A LIGHT terminal draws Medium (500): dark 1px Regular strokes on a light ground read thin and
 *  hard to read. Hack ships no Medium face (500 draws as 400), so this stack skips it and puts
 *  Noto Sans Mono, which has one, right after JetBrains Mono (operator's pick, 2026-09-30). */
const LIGHT_FONT_FAMILY = "'JetBrains Mono', 'Noto Sans Mono', ui-monospace, 'Hack', monospace"

export type TerminalFont = { fontFamily: string; fontWeight: 400 | 500 }

export function terminalFontFor(kind: TerminalKind): TerminalFont {
  return kind === 'light'
    ? { fontFamily: LIGHT_FONT_FAMILY, fontWeight: 500 }
    : { fontFamily: TERMINAL_FONT_FAMILY, fontWeight: 400 }
}

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
