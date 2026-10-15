// The docs/themes/examples folders as the theme tests read them: the scanner over that folder, and
// a theme's CSS as `{ selectors, body }` rules. Used by themeExamples.test and
// themeExamples.liquidGlassV2.test. Never shipped.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createThemeScanner } from '../main/themes/themeScanner'

const here = dirname(fileURLToPath(import.meta.url))
export const examples = resolve(here, '../../docs/themes/examples')
export const scanner = createThemeScanner({ dir: examples, log: () => {} })

// <id>/theme.css as `{ selectors, body }` rules, comments stripped. No nesting is parsed:
// the inner rules of an @media / @font-face block read as top-level rules, which the assertions
// below accept (they check bodies by selector; @media guards are raw-text tests).
export function themeRules(id: 'liquid-glass' | 'paper'): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(examples, `${id}/theme.css`), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel = '', body = '']) => ({
    // One line per selector: Prettier wraps a long one (and inside `:not(…)`).
    selectors: sel
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')),
    body
  }))
}
export const liquidGlassRules = (): ReturnType<typeof themeRules> => themeRules('liquid-glass')
