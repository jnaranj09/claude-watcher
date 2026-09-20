import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { DEFAULT_THEME_BUNDLE } from '../../../shared/schemas/theme'
import { renderComponent } from '../test/renderComponent'
import { themeStore } from '../stores/themeStore'
import { applyThemeToDocument, useApplyTheme, THEME_STYLE_ID } from './useApplyTheme'

const here = dirname(fileURLToPath(import.meta.url))

afterEach(() => {
  document.getElementById(THEME_STYLE_ID)?.remove()
  document.documentElement.style.colorScheme = ''
  act(() => themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE))
})

describe('applyThemeToDocument', () => {
  it('creates ONE style node and replaces its text on the next call', () => {
    applyThemeToDocument(document, { ...DEFAULT_THEME_BUNDLE, css: ':root{--bg-base:#000}' })
    applyThemeToDocument(document, { ...DEFAULT_THEME_BUNDLE, css: ':root{--bg-base:#fff}' })
    const nodes = document.querySelectorAll(`style#${THEME_STYLE_ID}`)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.textContent).toBe(':root{--bg-base:#fff}')
    expect(nodes[0]?.parentElement).toBe(document.head)
  })
  it('sets the root color-scheme from the bundle', () => {
    applyThemeToDocument(document, { ...DEFAULT_THEME_BUNDLE, colorScheme: 'light' })
    expect(document.documentElement.style.colorScheme).toBe('light')
    applyThemeToDocument(document, DEFAULT_THEME_BUNDLE)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})

describe('useApplyTheme', () => {
  function Probe(): null {
    useApplyTheme()
    return null
  }
  it('applies the store bundle on mount and on every change', () => {
    const { unmount } = renderComponent(<Probe />)
    expect(document.getElementById(THEME_STYLE_ID)?.textContent).toBe('')
    act(() =>
      themeStore
        .getState()
        .setBundle({ ...DEFAULT_THEME_BUNDLE, css: 'body{}', colorScheme: 'light' })
    )
    expect(document.getElementById(THEME_STYLE_ID)?.textContent).toBe('body{}')
    expect(document.documentElement.style.colorScheme).toBe('light')
    unmount()
  })
})

describe('the fixed dark declarations moved to the theme', () => {
  it('main.css no longer pins color-scheme (the applied bundle sets it)', () => {
    const css = readFileSync(resolve(here, '../assets/main.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    expect(css).not.toMatch(/color-scheme\s*:/)
  })
  it('the CSP allows inlined fonts (font-src data:) and keeps img-src data:', () => {
    const html = readFileSync(resolve(here, '../../index.html'), 'utf8')
    expect(html).toMatch(/font-src 'self' data:/)
    expect(html).toMatch(/img-src 'self' data:/)
    expect(html).toMatch(/style-src 'self' 'unsafe-inline'/)
  })
})
