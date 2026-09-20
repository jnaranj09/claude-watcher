// The default xterm ITheme lives in src/shared/theme/xtermTheme.ts (the examples test in main
// compares a package against it). `xtermThemeFor` is what a live terminal applies: the default
// palette with the applied theme's terminal keys on top. `allowTransparency` is NOT an ITheme
// key — EmbeddedTerminal reads it at creation (xterm needs it before open()).
import type { ITheme } from '@xterm/xterm'
import { xtermTheme } from '../../../shared/theme/xtermTheme'
import { TERMINAL_THEME_KEYS, type ThemeTerminal } from '../../../shared/schemas/theme'

export { xtermTheme }

export function xtermThemeFor(terminal: ThemeTerminal): ITheme {
  const out: ITheme = { ...xtermTheme }
  for (const key of TERMINAL_THEME_KEYS) {
    const value = terminal[key]
    if (value !== undefined) out[key] = value
  }
  return out
}
