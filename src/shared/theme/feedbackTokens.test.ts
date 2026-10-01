// Feedback callout tokens (spec 2026-10-01-feedback-callout-design.md). The fills mix the tone over
// the theme's raised surface; text, the icon disc and its glyph must stay readable on them, in the
// defaults and in Paper (a light theme).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}
const MIX = /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, var\(--bg-surface-raised\)\)$/
function resolve(value: string, surface: string): string {
  const m = MIX.exec(value)
  if (m === null) throw new Error(`not a surface mix: ${value}`)
  const [hue, pct] = [m[1] ?? '', Number(m[2]) / 100]
  const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(ch(hue, i) * pct + ch(surface, i) * (1 - pct)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

const paper = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/themes/examples/paper/theme.json'), 'utf8')
) as { tokens: Record<string, string> }

const THEMES: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['default', { ...TOKENS }],
  ['paper', { ...TOKENS, ...paper.tokens }]
]

describe('feedback tokens', () => {
  for (const [name, t] of THEMES) {
    it(`${name}: text, the icon disc and its glyph stay readable on both fills`, () => {
      const surface = t['bg-surface-raised'] ?? ''
      for (const tone of ['success', 'danger'] as const) {
        const fill = resolve(t[`${tone}-fill`] ?? '', surface)
        const disc = t[tone] ?? ''
        expect(contrast(t['text-primary'] ?? '', fill), `${tone} text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(disc, fill), `${tone} disc`).toBeGreaterThanOrEqual(3)
        // The glyph is an aria-hidden ICON (the words say it): the 3:1 non-text floor (WCAG
        // 1.4.11). White on the default --danger is 4.1:1 — the armed Delete's pair, unchanged.
        expect(contrast(t[`text-on-${tone}`] ?? '', disc), `${tone} glyph`).toBeGreaterThanOrEqual(3)
      }
    })
  }
})
