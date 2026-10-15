// Story 1.3 — emphasis primitives tests (AC-7, AC-8).
//
// Asserts: the LiveAnnouncer renders an `aria-live="polite"` region (and updates);
// the pulse class hook is exported; and the `prefers-reduced-motion: reduce` fallback
// rule EXISTS in the CSS module source.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { needsYouEmphasisClass, emphasisStyles } from './emphasis'
import { LiveAnnouncer } from './LiveAnnouncer'
import { renderComponent } from '../test/renderComponent'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('emphasis primitives — gold/pulse/reduced-motion/announcer (AC-7, AC-8)', () => {
  it('exports a non-empty pulse class hook', () => {
    expect(typeof needsYouEmphasisClass).toBe('string')
    expect(needsYouEmphasisClass.length).toBeGreaterThan(0)
    expect(emphasisStyles.needsYouEmphasis).toBeTruthy()
  })

  it('LiveAnnouncer renders an aria-live="polite" region', () => {
    const { container, unmount } = renderComponent(<LiveAnnouncer message="A session needs you" />)
    cleanup = unmount
    const region = container.querySelector('[data-testid="live-announcer"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.getAttribute('role')).toBe('status')
    expect(region?.textContent).toBe('A session needs you')
    // Visually hidden but present in the a11y tree.
    expect(region?.className).toContain('sr-only')
  })

  it('LiveAnnouncer defaults to an empty (mounted) region', () => {
    const { container, unmount } = renderComponent(<LiveAnnouncer />)
    cleanup = unmount
    const region = container.querySelector('[data-testid="live-announcer"]')
    expect(region).not.toBeNull()
    expect(region?.textContent).toBe('')
  })

  it('the CSS module defines the bounce keyframe AND the reduced-motion fallback', () => {
    const css = readFileSync(resolve(dirname(__filename), 'emphasis.module.css'), 'utf8')
    // Compositor-only cue: transform, on a slow cycle with a long rest.
    expect(css).toContain('@keyframes needsYouBounce')
    expect(css).toMatch(/animation:\s*needsYouBounce\s+2\.4s/)
    expect(css).toMatch(/translateY\(-4px\)/)
    // The accessibility floor: reduced-motion removes the cue.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/animation:\s*none/)
  })

  // THE BLUR REGRESSION (observed 2026-08-25). The cue is applied to the CARD ROOT, which
  // contains the session name, path and pid. The old cue pulsed `transform: scale(1.015)`,
  // and a non-integer scale rasterises every glyph off the pixel grid — the whole card went
  // soft for the entire animation. Worse, the reduced-motion branch left a STATIC
  // scale(1.015) applied, so users who opted out of motion got the blur permanently, forever.
  //
  // Any resampling transform brings it back, so this asserts the absence of the whole class,
  // not just the one value that was there before.
  it('never applies a resampling transform — that is what blurred the card text', () => {
    const css = readFileSync(resolve(dirname(__filename), 'emphasis.module.css'), 'utf8')
    const declarations = css
      .split('\n')
      .filter((l) => l.trimStart().startsWith('transform:') || l.includes('animation:'))
      .join('\n')

    expect(declarations).not.toMatch(/scale\(/)
    expect(declarations).not.toMatch(/rotate\(/)
    expect(declarations).not.toMatch(/skew\(/)
  })

  it('translates by WHOLE pixels only — a fractional offset blurs exactly like a scale', () => {
    const css = readFileSync(resolve(dirname(__filename), 'emphasis.module.css'), 'utf8')
    const offsets = [...css.matchAll(/translateY\((-?[\d.]+)px\)/g)].map((m) => Number(m[1]))

    expect(offsets.length).toBeGreaterThan(0)
    for (const px of offsets) {
      expect(Number.isInteger(px)).toBe(true)
    }
  })

  it('reduced-motion leaves NO residual transform (the old fallback pinned a static scale)', () => {
    const css = readFileSync(resolve(dirname(__filename), 'emphasis.module.css'), 'utf8')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

    expect(reduced).toMatch(/transform:\s*none/)
    expect(reduced).not.toMatch(/scale\(/)
  })
})
