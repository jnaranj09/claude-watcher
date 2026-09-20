import { describe, it, expect } from 'vitest'
import {
  ThemeManifestSchema,
  THEME_ASSET_MIME,
  THEME_ASSETS_MAX_BYTES,
  THEME_CSS_MAX_BYTES
} from '../../shared/schemas/theme'
import {
  composeTheme,
  createMapReader,
  renderTokensBlock,
  rewriteCssUrls,
  type ThemeReader
} from './themeCompose'
import type { ThemeManifest } from '../../shared/schemas/theme'

const manifest = (extra: Record<string, unknown> = {}): ThemeManifest =>
  ThemeManifestSchema.parse({ version: 1, name: 'T', ...extra })
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const b64 = Buffer.from(png).toString('base64')

describe('renderTokensBlock', () => {
  it('is empty for no tokens and one :root block otherwise', () => {
    expect(renderTokensBlock({})).toBe('')
    expect(renderTokensBlock({ 'bg-base': '#000', 'rounded-md': '10px' })).toBe(
      ':root {\n  --bg-base: #000;\n  --rounded-md: 10px;\n}\n'
    )
  })
})

describe('rewriteCssUrls', () => {
  const reader = createMapReader({ 'bg.png': png })
  it.each(['url(bg.png)', "url('bg.png')", 'url("bg.png")', 'url( bg.png )', 'url( "bg.png" )'])(
    'rewrites %s to a data: URI',
    (form) => {
      const r = rewriteCssUrls(`body{background:${form}}`, reader)
      expect(r).toEqual({ ok: true, css: `body{background:url("data:image/png;base64,${b64}")}` })
    }
  )
  it('uses the right MIME for every allowed extension', () => {
    for (const [ext, mime] of Object.entries(THEME_ASSET_MIME)) {
      const r = rewriteCssUrls(`url(a.${ext})`, createMapReader({ [`a.${ext}`]: png }))
      expect(r).toEqual({ ok: true, css: `url("data:${mime};base64,${b64}")` })
    }
  })
  it('counts a file referenced twice once against the cap', () => {
    const big = new Uint8Array(THEME_ASSETS_MAX_BYTES)
    const r = rewriteCssUrls('url(a.png) url(a.png)', createMapReader({ 'a.png': big }))
    expect(r.ok).toBe(true)
  })
  it.each([
    'http://x/a.png',
    'https://x/a.png',
    'data:image/png;base64,AA==',
    '/abs/a.png',
    '../a.png',
    'sub/a.png',
    ''
  ])('fails closed on %j (theme_css_url_invalid)', (bad) => {
    expect(rewriteCssUrls(`url(${bad})`, reader)).toEqual({
      ok: false,
      code: 'theme_css_url_invalid'
    })
  })
  it('fails closed on an unlisted extension (theme_asset_type_invalid)', () => {
    expect(rewriteCssUrls('url(a.exe)', createMapReader({ 'a.exe': png }))).toEqual({
      ok: false,
      code: 'theme_asset_type_invalid'
    })
  })
  it('fails closed on a missing asset (theme_asset_missing)', () => {
    expect(rewriteCssUrls('url(nope.png)', reader)).toEqual({
      ok: false,
      code: 'theme_asset_missing'
    })
  })
  it.each([
    'URL(https://evil.com/x.png)',
    'Url("https://evil.com/x.png")',
    'url("https://evil.com/a).png")',
    `url('https://evil.com/a".png')`
  ])('fails closed on the case/quote bypass %j (theme_css_url_invalid)', (bad) => {
    expect(rewriteCssUrls(bad, reader)).toEqual({ ok: false, code: 'theme_css_url_invalid' })
  })
  it('inlines URL(...) case-insensitively, not just lowercase url(...)', () => {
    const r = rewriteCssUrls('URL(bg.png)', reader)
    expect(r).toEqual({ ok: true, css: `url("data:image/png;base64,${b64}")` })
  })
  it('fails closed on an unterminated url( the pattern cannot fully match (residual check)', () => {
    expect(rewriteCssUrls('a{b:url(bg.png}', reader)).toEqual({
      ok: false,
      code: 'theme_css_url_invalid'
    })
  })
  it('fails closed on ..png — matched by the character class, caught by the explicit .. check', () => {
    expect(rewriteCssUrls('url(..png)', reader)).toEqual({
      ok: false,
      code: 'theme_css_url_invalid'
    })
  })
  it('first failure wins: a later url() is never read once one has already failed', () => {
    const calls: string[] = []
    const base = createMapReader({ 'b.png': png })
    const spyReader: ThemeReader = {
      read: (name) => {
        calls.push(name)
        return base.read(name)
      }
    }
    const r = rewriteCssUrls('url(missing.png) url(b.png)', spyReader)
    expect(r).toEqual({ ok: false, code: 'theme_asset_missing' })
    expect(calls).toEqual(['missing.png'])
  })
  it('fails closed one byte over the 5 MB cap and passes at the cap', () => {
    const at = new Uint8Array(THEME_ASSETS_MAX_BYTES)
    const over = new Uint8Array(THEME_ASSETS_MAX_BYTES - 3)
    expect(rewriteCssUrls('url(a.png)', createMapReader({ 'a.png': at })).ok).toBe(true)
    expect(
      rewriteCssUrls('url(a.png) url(b.png)', createMapReader({ 'a.png': over, 'b.png': png }))
    ).toEqual({ ok: false, code: 'theme_asset_too_large' })
  })
  it('fails closed when the reader throws (theme_read_failed)', () => {
    const throwing: ThemeReader = {
      read: () => {
        throw new Error('EACCES /secret/path')
      }
    }
    expect(rewriteCssUrls('url(a.png)', throwing)).toEqual({ ok: false, code: 'theme_read_failed' })
  })
  it('leaves CSS without url() untouched', () => {
    expect(rewriteCssUrls('a{color:red}', reader)).toEqual({ ok: true, css: 'a{color:red}' })
  })
})

describe('composeTheme', () => {
  it('tokens-only: the :root block, empty terminal passthrough, dark', () => {
    const r = composeTheme('t', manifest({ tokens: { 'bg-base': '#000' } }), createMapReader({}))
    expect(r).toEqual({
      ok: true,
      bundle: {
        id: 't',
        name: 'T',
        colorScheme: 'dark',
        css: ':root {\n  --bg-base: #000;\n}\n',
        terminal: {}
      }
    })
  })
  it('css-only: the file, urls rewritten, after an empty tokens block', () => {
    const r = composeTheme(
      't',
      manifest({ css: 'theme.css' }),
      createMapReader({ 'theme.css': 'body{background:url(bg.png)}', 'bg.png': png })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.css).toBe(`body{background:url("data:image/png;base64,${b64}")}`)
  })
  it('tokens + css: tokens first, then the css (later wins)', () => {
    const r = composeTheme(
      't',
      manifest({ tokens: { 'bg-base': '#000' }, css: 'theme.css' }),
      createMapReader({ 'theme.css': 'body{}' })
    )
    expect(r.ok && r.bundle.css).toBe(':root {\n  --bg-base: #000;\n}\nbody{}')
  })
  it('passes terminal and colorScheme through', () => {
    const r = composeTheme(
      't',
      manifest({ colorScheme: 'light', terminal: { red: '#f00', allowTransparency: true } }),
      createMapReader({})
    )
    expect(r.ok && r.bundle.colorScheme).toBe('light')
    expect(r.ok && r.bundle.terminal).toEqual({ red: '#f00', allowTransparency: true })
  })
  it('theme_css_missing when the named file is absent', () => {
    expect(composeTheme('t', manifest({ css: 'theme.css' }), createMapReader({}))).toEqual({
      ok: false,
      code: 'theme_css_missing'
    })
  })
  it('theme_css_too_large one byte over 1 MB, ok at 1 MB', () => {
    const at = 'a'.repeat(THEME_CSS_MAX_BYTES)
    expect(
      composeTheme('t', manifest({ css: 'theme.css' }), createMapReader({ 'theme.css': at })).ok
    ).toBe(true)
    expect(
      composeTheme('t', manifest({ css: 'theme.css' }), createMapReader({ 'theme.css': at + 'a' }))
    ).toEqual({ ok: false, code: 'theme_css_too_large' })
  })
  it('theme_read_failed when the css read throws', () => {
    const throwing: ThemeReader = {
      read: () => {
        throw new Error('EIO')
      }
    }
    expect(composeTheme('t', manifest({ css: 'theme.css' }), throwing)).toEqual({
      ok: false,
      code: 'theme_read_failed'
    })
  })
  it.each([
    'body{background:\\75 rl(https://evil.com/x.png)}',
    'u\\72 l(https://evil.com/x.png)',
    '\\000075rl(https://evil.com/x.png)',
    '@import "https://evil.com/x.css";',
    'a{b:image-set("https://evil.com/x.png" 1x)}'
  ])(
    'fails closed on the CSS-escape/@import/image-set bypass %j (theme_css_url_invalid)',
    (bad) => {
      const r = composeTheme(
        't',
        manifest({ css: 'theme.css' }),
        createMapReader({ 'theme.css': bad })
      )
      expect(r).toEqual({ ok: false, code: 'theme_css_url_invalid' })
    }
  )
})
