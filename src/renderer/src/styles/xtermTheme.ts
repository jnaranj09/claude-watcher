// Story 1.3 — the xterm.js ITheme object (AC-2).
//
// Built from the DESIGN.md `embedded-terminal` token block (Catppuccin Mocha ANSI
// on a neutral-black ground, `#141312`). The JS theme object and the CSS chrome
// read the SAME tokens so the terminal and the app can never drift — one source of
// truth (UX-DR2).
//
// SCOPE: Story 1.3 ships the theme OBJECT + a drift test only. It is NOT wired into
// any live terminal here — the live themed xterm is Epic 3 (App.tsx's terminal is
// the Story-0.1 smoke shell and is left untouched). [.claude/rules/terminal.md —
// imperative xterm ownership applies to Epic 3, not this story.]
//
// [Source: DESIGN.md frontmatter `components.embedded-terminal`]
import type { ITheme } from '@xterm/xterm'

/**
 * The `embedded-terminal` token values, transcribed 1:1 from the DESIGN.md
 * frontmatter. Resolved references (`{colors.bg-terminal}` etc.) are inlined to
 * their concrete hex so this object is self-contained AND directly comparable in
 * the drift test. The frontmatter's resolved values:
 *   background `{colors.bg-terminal}`   = #141312
 *   foreground `{colors.text-primary}`  = #d6d3ca
 *   cursor                              = #d6d3ca
 *   cursorAccent `{colors.bg-terminal}` = #141312
 *
 * NOTE: the terminal keeps the FULL Catppuccin Mocha ANSI palette (incl. ANSI red
 * `#f38ba8` / yellow `#f9e2af`) — verbatim machine output on a different plane from
 * the app's gold/lavender semantics. Do NOT "reconcile" ANSI red/yellow with gold.
 */
export const xtermTheme: ITheme = {
  background: '#141312',
  foreground: '#d6d3ca',
  cursor: '#d6d3ca',
  cursorAccent: '#141312',
  selectionBackground: 'rgba(60,58,48,0.85)',
  black: '#1a1a18',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#a4a094',
  brightBlack: '#47453d',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#d6d3ca'
}
