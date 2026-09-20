import { describe, it, expect } from 'vitest'
import {
  ThemeManifestSchema,
  ThemeBundleSchema,
  ThemeSummarySchema,
  ThemeIdSchema,
  THEME_ERROR_CODES,
  TERMINAL_THEME_KEYS,
  TOKEN_NAMES,
  isSafeCssValue,
  DEFAULT_THEME_BUNDLE
} from './theme'
import { TOKENS } from '../theme/tokens'

const minimal = { version: 1, name: 'Paper' }

describe('ThemeManifestSchema — our shape, strict, fail-closed', () => {
  it('accepts the minimal manifest and fills the defaults', () => {
    const r = ThemeManifestSchema.parse(minimal)
    expect(r).toEqual({ version: 1, name: 'Paper', colorScheme: 'dark', tokens: {}, terminal: {} })
  })

  it('accepts every optional field', () => {
    const r = ThemeManifestSchema.parse({
      $schema: 'https://example.invalid/theme.schema.json',
      ...minimal,
      author: 'jose',
      colorScheme: 'light',
      tokens: { 'bg-base': '#ffffff', 'rounded-md': '10px' },
      terminal: { background: 'rgba(0,0,0,0)', allowTransparency: true, red: '#f38ba8' },
      css: 'theme.css'
    })
    expect(r.colorScheme).toBe('light')
    expect(r.tokens['bg-base']).toBe('#ffffff')
    expect(r.terminal.allowTransparency).toBe(true)
    expect(r.css).toBe('theme.css')
  })

  it('rejects an unknown top-level key (strict)', () => {
    expect(ThemeManifestSchema.safeParse({ ...minimal, extra: 1 }).success).toBe(false)
  })

  it('rejects version 2, a missing name, a blank name and an 81-char name', () => {
    expect(ThemeManifestSchema.safeParse({ version: 2, name: 'x' }).success).toBe(false)
    expect(ThemeManifestSchema.safeParse({ version: 1 }).success).toBe(false)
    expect(ThemeManifestSchema.safeParse({ version: 1, name: '   ' }).success).toBe(false)
    expect(ThemeManifestSchema.safeParse({ version: 1, name: 'a'.repeat(81) }).success).toBe(false)
  })

  it('rejects an unknown token name with an unrecognized_keys issue under tokens', () => {
    const r = ThemeManifestSchema.safeParse({ ...minimal, tokens: { 'bg-bas': '#000' } })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path).toEqual(['tokens'])
      expect(issue?.code).toBe('unrecognized_keys')
    }
  })

  it('accepts every token name', () => {
    const tokens = Object.fromEntries(TOKEN_NAMES.map((n) => [n, TOKENS[n]]))
    expect(ThemeManifestSchema.safeParse({ ...minimal, tokens }).success).toBe(true)
  })

  it.each(['url(x.png)', 'URL(x.png)', 'a;b', 'a{', '}', '/* c */', 'a\nb', 'a\rb'])(
    'rejects the token value %j (an injection point, not a value)',
    (bad) => {
      expect(
        ThemeManifestSchema.safeParse({ ...minimal, tokens: { 'bg-base': bad } }).success
      ).toBe(false)
      expect(ThemeManifestSchema.safeParse({ ...minimal, terminal: { red: bad } }).success).toBe(
        false
      )
    }
  )

  it('accepts rgba() and gradients as token values', () => {
    expect(isSafeCssValue('rgba(0,0,0,0.5)')).toBe(true)
    expect(isSafeCssValue('linear-gradient(180deg, #000 0%, #fff 100%)')).toBe(true)
  })

  it('rejects a 501-char token value and a 101-char terminal value', () => {
    expect(
      ThemeManifestSchema.safeParse({ ...minimal, tokens: { 'bg-base': 'a'.repeat(501) } }).success
    ).toBe(false)
    expect(
      ThemeManifestSchema.safeParse({ ...minimal, terminal: { red: 'a'.repeat(101) } }).success
    ).toBe(false)
  })

  it('rejects an unknown terminal key and a non-boolean allowTransparency', () => {
    expect(ThemeManifestSchema.safeParse({ ...minimal, terminal: { bold: '#fff' } }).success).toBe(
      false
    )
    expect(
      ThemeManifestSchema.safeParse({ ...minimal, terminal: { allowTransparency: 'yes' } }).success
    ).toBe(false)
  })

  it('TERMINAL_THEME_KEYS has the 7 surface keys + 16 ANSI colours', () => {
    expect(TERMINAL_THEME_KEYS).toHaveLength(23)
    expect(TERMINAL_THEME_KEYS).toContain('selectionInactiveBackground')
    expect(TERMINAL_THEME_KEYS).toContain('brightWhite')
  })

  it('colorScheme accepts dark and light and nothing else', () => {
    expect(ThemeManifestSchema.safeParse({ ...minimal, colorScheme: 'light' }).success).toBe(true)
    expect(ThemeManifestSchema.safeParse({ ...minimal, colorScheme: 'auto' }).success).toBe(false)
  })

  it.each(['theme.css', 'my-theme_2.css', 'a.b.css'])('accepts the css file name %s', (name) => {
    expect(ThemeManifestSchema.safeParse({ ...minimal, css: name }).success).toBe(true)
  })

  it.each(['sub/theme.css', '../theme.css', '/abs.css', 'theme.CSS', 'theme.scss', 'x..css', ''])(
    'rejects the css file name %j',
    (name) => {
      expect(ThemeManifestSchema.safeParse({ ...minimal, css: name }).success).toBe(false)
    }
  )
})

describe('theme ids', () => {
  it.each(['default', 'liquid-glass', 'a', '0', 'a'.repeat(64)])('accepts %s', (id) => {
    expect(ThemeIdSchema.safeParse(id).success).toBe(true)
  })
  it.each(['Liquid', '-x', 'a_b', 'a.b', 'a'.repeat(65), '', 'a/b'])('rejects %j', (id) => {
    expect(ThemeIdSchema.safeParse(id).success).toBe(false)
  })
})

describe('wire shapes', () => {
  it('has exactly the 15 error codes from the spec', () => {
    expect([...THEME_ERROR_CODES].sort()).toEqual(
      [
        'theme_not_found',
        'theme_id_invalid',
        'theme_id_reserved',
        'theme_manifest_missing',
        'theme_manifest_invalid',
        'theme_manifest_too_large',
        'theme_unknown_token',
        'theme_token_value_invalid',
        'theme_css_missing',
        'theme_css_too_large',
        'theme_css_url_invalid',
        'theme_asset_missing',
        'theme_asset_type_invalid',
        'theme_asset_too_large',
        'theme_read_failed'
      ].sort()
    )
  })

  it('DEFAULT_THEME_BUNDLE is a valid bundle', () => {
    expect(ThemeBundleSchema.safeParse(DEFAULT_THEME_BUNDLE).success).toBe(true)
    expect(DEFAULT_THEME_BUNDLE).toEqual({
      id: 'default',
      name: 'Default',
      colorScheme: 'dark',
      css: '',
      terminal: {}
    })
  })

  it('ThemeBundleSchema is strict and rejects a bad id', () => {
    expect(ThemeBundleSchema.safeParse({ ...DEFAULT_THEME_BUNDLE, extra: 1 }).success).toBe(false)
    expect(ThemeBundleSchema.safeParse({ ...DEFAULT_THEME_BUNDLE, id: 'Bad Id' }).success).toBe(
      false
    )
  })

  it('ThemeSummarySchema accepts a broken entry with a code and a path', () => {
    const r = ThemeSummarySchema.safeParse({
      id: 'paper',
      name: 'paper',
      colorScheme: 'dark',
      error: 'theme_unknown_token',
      path: 'tokens.bg-bas'
    })
    expect(r.success).toBe(true)
    expect(
      ThemeSummarySchema.safeParse({
        id: 'paper',
        name: 'paper',
        colorScheme: 'dark',
        error: 'nope'
      }).success
    ).toBe(false)
  })
})
