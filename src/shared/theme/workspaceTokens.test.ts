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
      const fill = TOKENS[`workspace-${c}-fill` as keyof typeof TOKENS]
      expect(contrast(TOKENS['text-primary'], fill), c).toBeGreaterThanOrEqual(4.5)
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
