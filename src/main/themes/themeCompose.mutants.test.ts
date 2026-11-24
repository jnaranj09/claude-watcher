// Theme rules the mutation run (StrykerJS) showed no test pinned, in `shared/schemas/theme.ts`:
// the MIME each asset type is inlined with, and a theme summary's author and wallpaper names.
import { describe, it, expect } from 'vitest'
import { createMapReader, rewriteCssUrls } from './themeCompose'
import { ThemeSummarySchema } from '../../shared/schemas/theme'

describe('rewriteCssUrls — the MIME of an inlined asset', () => {
  it.each([
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.svg', 'image/svg+xml'],
    ['a.woff', 'font/woff'],
    ['a.ttf', 'font/ttf'],
    ['a.otf', 'font/otf']
  ])('inlines %s as a %s data URI', (file, mime) => {
    const out = rewriteCssUrls(`b { background: url(${file}); }`, createMapReader({ [file]: 'x' }))
    expect(out).toEqual({ ok: true, css: `b { background: url("data:${mime};base64,eA=="); }` })
  })
})

describe('ThemeSummarySchema', () => {
  it('accepts a short author name', () => {
    const r = ThemeSummarySchema.safeParse({
      id: 'paper',
      name: 'Paper',
      author: 'op',
      colorScheme: 'light'
    })
    expect(r.success).toBe(true)
  })

  it('accepts a wallpaper name longer than one character', () => {
    const r = ThemeSummarySchema.safeParse({
      id: 'paper',
      name: 'Paper',
      colorScheme: 'light',
      wallpapers: [{ id: 'dawn', name: 'Dawn' }]
    })
    expect(r.success).toBe(true)
  })
})
