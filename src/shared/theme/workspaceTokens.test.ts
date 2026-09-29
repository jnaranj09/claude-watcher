// The workspace tint tokens (spec 2026-09-29-workspace-tint-design.md). Every WORKSPACE_COLORS
// entry needs a fill AND a border, in the defaults AND in Paper (a light theme that left one out
// would fall back to a DARK fill under dark text). Text on every fill must stay readable.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'
import { WORKSPACE_COLORS } from '../schemas/workspace'

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

// The DEFAULT tints are `color-mix(in srgb, <hue> N%, var(--bg-surface-raised))`, so a theme that
// sets no workspace token (an operator's own theme written before them) still gets a tint of ITS
// surface — a light theme gets light boxes, never the dark defaults under its dark text.
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

describe('workspace tint tokens', () => {
  it('declares a fill and a border for every workspace colour', () => {
    for (const c of WORKSPACE_COLORS) {
      expect(TOKENS, c).toHaveProperty(`workspace-${c}-fill`)
      expect(TOKENS, c).toHaveProperty(`workspace-${c}-border`)
    }
  })

  it('keeps text-primary readable on every default fill (≥ 4.5:1)', () => {
    for (const c of WORKSPACE_COLORS) {
      const fill = resolve(TOKENS[`workspace-${c}-fill`], TOKENS['bg-surface-raised'])
      expect(contrast(TOKENS['text-primary'], fill), c).toBeGreaterThanOrEqual(4.5)
    }
  })

  // Review finding: opaque dark defaults left a light theme that sets none of these tokens with
  // dark text on dark boxes. The defaults mix over the theme's own raised surface instead.
  it('builds every default from the theme surface, so a light theme with no workspace tokens stays readable', () => {
    const light = { surface: '#ffffff', text: '#2b2925' }
    for (const c of WORKSPACE_COLORS) {
      const fill = TOKENS[`workspace-${c}-fill`]
      expect(fill, c).toMatch(MIX)
      expect(TOKENS[`workspace-${c}-border`], c).toMatch(MIX)
      expect(contrast(light.text, resolve(fill, light.surface)), c).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives Paper its own light values, readable under its text (≥ 4.5:1)', () => {
    const text = paper.tokens['text-primary']
    expect(text).toBeDefined()
    for (const c of WORKSPACE_COLORS) {
      const fill = paper.tokens[`workspace-${c}-fill`]
      expect(fill, `paper workspace-${c}-fill`).toBeDefined()
      expect(paper.tokens[`workspace-${c}-border`], `paper workspace-${c}-border`).toBeDefined()
      expect(contrast(text ?? '', fill ?? ''), c).toBeGreaterThanOrEqual(4.5)
    }
  })
})
