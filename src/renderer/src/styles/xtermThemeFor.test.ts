import { describe, it, expect } from 'vitest'
import {
  xtermTheme,
  xtermLightTheme,
  xtermThemeFor,
  terminalKindFor,
  minimumContrastFor,
  terminalFontFor,
  TERMINAL_FONT_FAMILY,
  frameBackgroundFor,
  transparentGround
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

  // A see-through theme (liquid-glass) lights the frame's padding ring with an inset glow and a
  // `::before` filter. An OPAQUE xterm ground over that showed as a darker square-cornered box
  // inside the rounded frame (operator, 2026-10-01). With transparency on, a built-in palette's
  // ground keeps its RGB at alpha 0: the frame paints it (frameBackgroundFor), and xterm still
  // computes the light contrast floor, the selection blend and inverse text from the real colour.
  it('"dark" / "light" keep the ground RGB at alpha 0 when the terminal is transparent', () => {
    const theme = { background: 'rgba(0,0,0,0)', red: '#f00' }
    for (const [scheme, palette] of [
      ['dark', xtermTheme],
      ['light', xtermLightTheme]
    ] as const) {
      const t = xtermThemeFor(theme, scheme, { transparent: true })
      expect(t.background, scheme).toBe(`${String(palette.background)}00`)
      expect({ ...t, background: palette.background }, scheme).toEqual(palette)
      expect(frameBackgroundFor(scheme), scheme).toBe(palette.background)
    }
    // Opaque terminals (transparency off) keep the palette's own ground.
    expect(xtermThemeFor(theme, 'dark')).toEqual(xtermTheme)
    // Under "theme" the theme's own ground rules.
    expect(xtermThemeFor({ red: '#f00' }, 'theme', { transparent: true }).background).toBe(
      xtermTheme.background
    )
  })

  // The light floor (7:1) is measured against the ground's RGB. A black RGB (`rgba(0,0,0,0)`)
  // made xterm lift every dark glyph to mid-grey on the near-white frame.
  it('a transparent light ground still measures as the light palette, not as black', () => {
    const ground = String(xtermThemeFor({}, 'light', { transparent: true }).background)
    expect(ground.slice(0, 7)).toBe(String(xtermLightTheme.background))
    const fg = String(xtermLightTheme.foreground)
    expect(contrast(hexToRgb(fg), hexToRgb(ground.slice(0, 7)))).toBeGreaterThanOrEqual(7)
  })

  it('transparentGround refuses anything but #rrggbb', () => {
    expect(transparentGround('#141312')).toBe('#14131200')
    expect(() => transparentGround('rgba(0,0,0,1)')).toThrow()
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
