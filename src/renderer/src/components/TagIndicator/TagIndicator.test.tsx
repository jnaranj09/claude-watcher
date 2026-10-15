// Tags — the rail's compact tag mark (spec T-27, §4.2b). jsdom `unit` project.
import { describe, it, expect, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { TagIndicator } from './TagIndicator'
import { TAG_GLYPH_PATH } from './tagGlyph'
import { TOKENS } from '../../../../shared/theme/tokens'
import { TAG_COLORS, type TagColor } from '../../../../shared/schemas/tag'
import { contrast, hexToRgb, over } from '../../test/contrast'

const tag = (id: string, color: TagColor): { id: string; color: TagColor } => ({ id, color })

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(el: ReactElement): RenderResult {
  const r = renderComponent(el)
  cleanup = r.unmount
  return r
}

const glyphs = (r: RenderResult): { role: string | null; color: string | null }[] =>
  [...r.container.querySelectorAll('[data-testid="tag-glyph"]')].map((g) => ({
    role: g.getAttribute('data-role'),
    color: g.getAttribute('data-color')
  }))

describe('TagIndicator — the rail compact view (T-27, §4.2b)', () => {
  it('draws nothing for no tags', () => {
    const r = render(<TagIndicator tags={[]} />)
    expect(r.container.querySelector('[data-testid="tag-indicator"]')).toBeNull()
  })

  it('one tag → one glyph in its colour, no +', () => {
    const r = render(<TagIndicator tags={[tag('a', 'rose')]} />)
    expect(glyphs(r)).toEqual([{ role: 'front', color: 'rose' }])
    expect(r.container.querySelector('[data-testid="tag-indicator-plus"]')).toBeNull()
    expect(r.container.querySelector('mask')).toBeNull()
  })

  it('two tags → two overlapped glyphs: the FIRST in front, the second cut behind it', () => {
    const r = render(<TagIndicator tags={[tag('a', 'rose'), tag('b', 'amber')]} />)
    expect(glyphs(r)).toEqual([
      { role: 'back', color: 'amber' },
      { role: 'front', color: 'rose' }
    ])
    expect(r.container.querySelector('[data-role="back"]')?.closest('g[mask]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="tag-indicator-plus"]')).toBeNull()
  })

  // Controller ruling (overrides the brief's task-7 test): the `+` is drawn as an SVG PATH (two
  // short strokes), never a text glyph — as text it needs 4.5:1 and measures only 3.21:1 on the
  // needs-you row; as a graphic the non-text 3:1 floor applies and it clears (see the contrast
  // describe block below). So detect it structurally (a <path>, no textContent), not by '+' text.
  it('three or more → the first two glyphs, in tag-list order, and a + drawn as a path, not text', () => {
    const r = render(
      <TagIndicator
        tags={[tag('a', 'violet'), tag('b', 'blue'), tag('c', 'rose'), tag('d', 'slate')]}
      />
    )
    expect(glyphs(r)).toEqual([
      { role: 'back', color: 'blue' },
      { role: 'front', color: 'violet' }
    ])
    const plus = r.container.querySelector('[data-testid="tag-indicator-plus"]')
    expect(plus).not.toBeNull()
    expect(plus?.querySelector('path')).not.toBeNull()
    expect(plus?.textContent).toBe('')
  })

  it('the glyph is the tag outline — never a circle, so it cannot read as a status or workspace dot', () => {
    const r = render(<TagIndicator tags={[tag('a', 'rose')]} />)
    const outline = r.container.querySelector('[data-testid="tag-glyph"] path')
    expect(outline?.getAttribute('d')).toBe(TAG_GLYPH_PATH)
  })

  it('two indicators never share a mask id', () => {
    const r = render(
      <>
        <TagIndicator tags={[tag('a', 'rose'), tag('b', 'blue')]} />
        <TagIndicator tags={[tag('c', 'green'), tag('d', 'amber')]} />
      </>
    )
    const ids = [...r.container.querySelectorAll('mask')].map((m) => m.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  // The rail's LIT peek toggle: the hues would sit on a light fill, so every stroke takes the
  // button's ink — and the SHAPE stays, so the toggle keeps its width when it lights.
  it('mono keeps the shape but drops every colour class, so the strokes take the parent ink', () => {
    const tags = [tag('a', 'rose'), tag('b', 'blue'), tag('c', 'green')]
    const r = render(<TagIndicator tags={tags} mono />)
    const root = r.container.querySelector('[data-testid="tag-indicator"]')
    expect(root?.hasAttribute('data-mono')).toBe(true)
    expect(glyphs(r)).toEqual([
      { role: 'back', color: 'blue' },
      { role: 'front', color: 'rose' }
    ])
    for (const g of r.container.querySelectorAll('[data-testid="tag-glyph"]')) {
      expect(g.getAttribute('class')).toBe('')
    }
    expect(r.container.querySelector('[data-testid="tag-indicator-plus"]')).not.toBeNull()
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/TagIndicator/TagIndicator.module.css'),
      'utf8'
    )
    expect(/\.mono \.plus\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/color:\s*inherit/)
  })
})

// Asserted on the token VALUES and the stylesheet TEXT (design.md: CSS-module classes are a proxy).
describe('TagIndicator colours — the non-text 3:1 floor on every rail row fill', () => {
  const rest = hexToRgb(TOKENS['bg-row-rest'])
  const fills = {
    resting: rest,
    // AttentionRail.module.css `.emphasized`: color-mix(in srgb, --needs-you 14%, --bg-row-rest)
    'needs-you': over(hexToRgb(TOKENS['needs-you']), 0.14, rest),
    // AttentionRail.module.css `.active`: --bg-base
    active: hexToRgb(TOKENS['bg-base'])
  }

  it('every tag stroke clears 3:1 on the resting, needs-you and active fills', () => {
    for (const c of TAG_COLORS) {
      for (const [name, fill] of Object.entries(fills)) {
        const ratio = contrast(hexToRgb(TOKENS[`tag-${c}-text`]), fill)
        expect(ratio, `${c} on ${name}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('the + clears 3:1 on the same three fills (drawn as a graphic, not text — the non-text floor)', () => {
    for (const [name, fill] of Object.entries(fills)) {
      expect(contrast(hexToRgb(TOKENS['text-secondary']), fill), name).toBeGreaterThanOrEqual(3)
    }
  })

  it('each colour class strokes with its --tag-<colour>-text token; the + uses --text-secondary', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/TagIndicator/TagIndicator.module.css'),
      'utf8'
    )
    for (const c of TAG_COLORS) {
      const rule = new RegExp(`\\.${c}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
      expect(rule, `.${c}`).toContain(`var(--tag-${c}-text)`)
    }
    expect(/\.plus\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toContain('var(--text-secondary)')
  })
})
