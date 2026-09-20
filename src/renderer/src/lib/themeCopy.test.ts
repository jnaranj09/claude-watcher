import { describe, it, expect } from 'vitest'
import { THEME_ERROR_CODES } from '../../../shared/schemas/theme'
import { THEME_ERROR_COPY, themeErrorCopy, brokenThemesLine } from './themeCopy'

describe('themeCopy', () => {
  it('has plain copy for every code, none of it a raw code', () => {
    for (const code of THEME_ERROR_CODES) {
      expect(THEME_ERROR_COPY[code].length).toBeGreaterThan(0)
      expect(THEME_ERROR_COPY[code]).not.toContain('theme_')
    }
  })
  it('names the unknown token from the path', () => {
    expect(themeErrorCopy({ error: 'theme_unknown_token', path: 'tokens.bg-bas' })).toBe(
      'unknown token "bg-bas"'
    )
    expect(themeErrorCopy({ error: 'theme_unknown_token' })).toBe('unknown token')
    expect(themeErrorCopy({ error: 'theme_token_value_invalid', path: 'terminal.red' })).toBe(
      'invalid value for "terminal.red"'
    )
  })
  it('returns the empty string when there is no error', () => {
    expect(themeErrorCopy({})).toBe('')
  })
  it('ignores a path on a code that does not interpolate it', () => {
    expect(themeErrorCopy({ error: 'theme_css_missing', path: 'terminal.background' })).toBe(
      'missing theme.css'
    )
    expect(themeErrorCopy({ error: 'theme_manifest_invalid', path: 'tokens.bg-base' })).toBe(
      'theme.json is not valid'
    )
    expect(themeErrorCopy({ error: 'theme_css_url_invalid', path: 'tokens.bg-base' })).toBe(
      'a url(), backslash escape, @import, or image-set( in the CSS is not a plain local file'
    )
  })
  it('builds the helper line only from broken summaries', () => {
    expect(brokenThemesLine([{ id: 'ok', name: 'Ok', colorScheme: 'dark' }])).toBeNull()
    expect(
      brokenThemesLine([
        {
          id: 'liquid-glass',
          name: 'liquid-glass',
          colorScheme: 'dark',
          error: 'theme_css_missing'
        },
        { id: 'ok', name: 'Ok', colorScheme: 'dark' },
        {
          id: 'paper',
          name: 'paper',
          colorScheme: 'dark',
          error: 'theme_unknown_token',
          path: 'tokens.bg-bas'
        }
      ])
    ).toBe('Could not load: liquid-glass (missing theme.css), paper (unknown token "bg-bas")')
  })
  it('builds the helper line for exactly one broken theme', () => {
    expect(
      brokenThemesLine([
        {
          id: 'liquid-glass',
          name: 'liquid-glass',
          colorScheme: 'dark',
          error: 'theme_css_missing'
        }
      ])
    ).toBe('Could not load: liquid-glass (missing theme.css)')
  })
})
