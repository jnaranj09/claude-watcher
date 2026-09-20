import { describe, it, expect } from 'vitest'
import { xtermTheme, xtermThemeFor } from './xtermTheme'

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
