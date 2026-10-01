import { describe, it, expect } from 'vitest'
import {
  xtermTheme,
  xtermLightTheme,
  xtermThemeFor,
  terminalKindFor,
  minimumContrastFor,
  terminalFontFor,
  TERMINAL_FONT_FAMILY,
  frameBackgroundFor
} from './xtermTheme'
import { contrast, hexToRgb } from '../test/contrast'

describe('xtermThemeFor', () => {
  it('returns the default palette for an empty override', () => {
    expect(xtermThemeFor({})).toEqual(xtermTheme)
  })
  it('overlays only the keys the theme sets and drops allowTransparency', () => {
    const t = xtermThemeFor({ background: 'rgba(0,0,0,0)', red: '#f00', allowTransparency: true })
    expect(t.background).toBe('rgba(0,0,0,0)')
    expect(t.red).toBe('#f00')
    expect(t.green).toBe(xtermTheme.green)
    expect('allowTransparency' in t).toBe(false)
  })
  it('never mutates the shared default', () => {
    xtermThemeFor({ red: '#f00' })
    expect(xtermTheme.red).toBe('#f38ba8')
  })
})

describe('terminal colour scheme (spec 2026-09-30)', () => {
  const ANSI = [
    'foreground',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightMagenta',
    'brightCyan',
    'brightWhite'
  ] as const

  it('the light palette: every ANSI colour and the foreground reach 4.5:1 on its ground', () => {
    const ground = hexToRgb(String(xtermLightTheme.background))
    for (const key of ANSI) {
      const value = xtermLightTheme[key]
      expect(value, key).toBeDefined()
      expect(contrast(hexToRgb(String(value)), ground), key).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('"theme" keeps the theme overlay; "dark" / "light" ignore the theme keys', () => {
    const theme = { background: 'rgba(0,0,0,0)', red: '#f00' }
    expect(xtermThemeFor(theme, 'theme').red).toBe('#f00')
    expect(xtermThemeFor(theme, 'dark')).toEqual(xtermTheme)
    expect(xtermThemeFor(theme, 'light')).toEqual(xtermLightTheme)
  })

  it('the kind follows the theme only under "theme"', () => {
    expect(terminalKindFor('theme', 'light')).toBe('light')
    expect(terminalKindFor('theme', 'dark')).toBe('dark')
    expect(terminalKindFor('dark', 'light')).toBe('dark')
    expect(terminalKindFor('light', 'dark')).toBe('light')
  })

  it("a light terminal gets the 7 contrast floor; a dark one stays at xterm's 1", () => {
    expect(minimumContrastFor('light')).toBe(7)
    expect(minimumContrastFor('dark')).toBe(1)
  })

  it('a light terminal draws Medium from a stack whose first installed face has one; dark stays Regular', () => {
    const light = terminalFontFor('light')
    expect(light.fontWeight).toBe(500)
    // Hack has no Medium face: it must come after Noto Sans Mono, or 500 draws as 400.
    expect(light.fontFamily.indexOf("'Noto Sans Mono'")).toBeLessThan(
      light.fontFamily.indexOf("'Hack'")
    )
    expect(terminalFontFor('dark')).toEqual({ fontFamily: TERMINAL_FONT_FAMILY, fontWeight: 400 })
  })

  it('the frame paints the palette ground for dark / light, and nothing inline under "theme"', () => {
    expect(frameBackgroundFor('theme')).toBeUndefined()
    expect(frameBackgroundFor('dark')).toBe(xtermTheme.background)
    expect(frameBackgroundFor('light')).toBe(xtermLightTheme.background)
  })
})
