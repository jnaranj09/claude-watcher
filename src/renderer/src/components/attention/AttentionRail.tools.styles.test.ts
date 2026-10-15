// The rail row's tools (the rename pencil and the tag toggle) overlay the row's right edge. With a
// long name they sat ON the text and were hard to see (2026-09-29): the name only ever reserved
// room for ONE icon (the tag indicator). While the tools show — hover, keyboard focus in the row,
// or its tag peek open — the name must reserve room for BOTH, so its ellipsis ends before them.
// Base CSS, not a theme file, so it holds under every theme.
//
// Reads the stylesheet off disk: an imported *.module.css is a proxy in vitest (design.md).
import { describe, it, expect } from 'vitest'
import { cssRules, readCss } from '../../test/cssRule'

const rules = (): { selectors: string[]; body: string }[] =>
  cssRules(readCss('components/attention/AttentionRail.module.css'))

function paddingFor(selector: string): string | null {
  const hit = rules().find((r) => r.selectors.includes(selector))
  return /padding-right:\s*([^;]+);/.exec(hit?.body ?? '')?.[1]?.trim() ?? null
}

describe('AttentionRail — a long name leaves room for both row tools while they show', () => {
  for (const state of [':hover', ':focus-within']) {
    it(`reserves both tools on ${state}`, () => {
      expect(paddingFor(`.rowWrap:has(.rowTools)${state} .row`)).toBe(
        'calc(var(--inset-item-x) + var(--rail-tools-width))'
      )
      expect(paddingFor(`.rowWrap:has(.rowTools)${state} .row.active`)).toBe(
        'calc(var(--inset-item-x) + var(--rail-tools-width) - var(--rounded-md))'
      )
    })
  }

  it('reserves both tools while the row`s tag peek is open', () => {
    expect(paddingFor('.rowWrap:has(.toolSlot[data-open]) .row')).toBe(
      'calc(var(--inset-item-x) + var(--rail-tools-width))'
    )
    expect(paddingFor('.rowWrap:has(.toolSlot[data-open]) .row.active')).toBe(
      'calc(var(--inset-item-x) + var(--rail-tools-width) - var(--rounded-md))'
    )
  })

  // The pencil is Button's `xs` icon, a fixed 20px square (Button.module.css `.xs`); the tag
  // toggle is 20px too, up to 29px with its 3-or-more mark (PeekButton). The cluster has a 2px gap
  // and sits `--space-2` in from the row's right edge (`.rowTools`). Sized for the WIDEST case.
  it('the tools width is the pencil, the gap, the widest tag toggle and the right inset', () => {
    const hit = rules().find((r) => r.selectors.includes('.rowWrap'))
    expect(hit?.body).toMatch(
      /--rail-tools-width:\s*calc\(20px \+ 2px \+ 29px \+ var\(--space-2\)\);/
    )
  })
})

// A two-line row (the tag peek open, or "Show all tags") WRAPS. The name's flex-basis was `auto`,
// i.e. its whole unwrapped text: a long name did not fit beside the dot, so the dot sat alone on
// line 1 and the name dropped to line 2 (2026-09-29). Basis 0 makes it take the rest of line 1 and
// ellipsize there.
describe('AttentionRail — a two-line row keeps the name beside its dot', () => {
  it('the name starts from zero width and grows into the first line', () => {
    const hit = rules().find((r) => r.selectors.includes('.row[data-two-line] .name'))
    expect(hit?.body).toMatch(/flex-basis:\s*0;/)
  })
})
