// The docs examples ARE theme folders: the scanner reads them as an operator's themes folder.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { TOKENS } from '../../shared/theme/tokens'
import { xtermTheme } from '../../shared/theme/xtermTheme'
import { createThemeScanner } from './themeScanner'

const here = dirname(fileURLToPath(import.meta.url))
const examples = resolve(here, '../../../docs/themes/examples')
const scanner = createThemeScanner({ dir: examples, log: () => {} })

describe('docs/themes/examples', () => {
  it('scan lists the three examples, none broken, sorted by name', () => {
    expect(scanner.scan()).toEqual([
      { id: 'builtin-dark', name: 'Built-in dark', author: 'claude-watcher', colorScheme: 'dark' },
      { id: 'liquid-glass', name: 'Liquid Glass', author: 'claude-watcher', colorScheme: 'dark' },
      { id: 'paper', name: 'Paper', author: 'claude-watcher', colorScheme: 'light' }
    ])
  })
  it('builtin-dark equals TOKENS + xtermTheme', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(examples, 'builtin-dark/theme.json'), 'utf8')
    ) as { tokens: unknown; terminal: unknown }
    expect(manifest.tokens).toEqual(TOKENS)
    expect(manifest.terminal).toEqual(xtermTheme)
    const r = scanner.load('builtin-dark')
    expect(r.ok).toBe(true)
  })
  it('liquid-glass composes with a transparent terminal and backdrop-filter in its CSS', () => {
    const r = scanner.load('liquid-glass')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.terminal.allowTransparency).toBe(true)
      expect(r.bundle.css).toContain('backdrop-filter')
      expect(r.bundle.css.startsWith(':root {')).toBe(true)
    }
  })
  it('paper is a light, tokens-only theme', () => {
    const r = scanner.load('paper')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.colorScheme).toBe('light')
      expect(r.bundle.css).toMatch(/^:root \{[\s\S]*\}\n$/)
      expect(r.bundle.css).not.toContain('backdrop')
    }
  })
})
