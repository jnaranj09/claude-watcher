// Story 1.3 — emphasis primitives tests (AC-7, AC-8).
//
// Asserts: the LiveAnnouncer renders an `aria-live="polite"` region (and updates);
// the gold token reference is exported; the pulse class hook is exported; and the
// `prefers-reduced-motion: reduce` fallback rule EXISTS in the CSS module source.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { NEEDS_YOU_TOKEN, needsYouEmphasisClass, emphasisStyles } from './emphasis'
import { LiveAnnouncer } from './LiveAnnouncer'
import { renderComponent } from '../test/renderComponent'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('emphasis primitives — gold/pulse/reduced-motion/announcer (AC-7, AC-8)', () => {
  it('exports the gold token reference (the one reserved alert hue)', () => {
    expect(NEEDS_YOU_TOKEN).toBe('var(--needs-you)')
  })

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

  it('the CSS module defines the pulse keyframe AND the reduced-motion fallback', () => {
    const css = readFileSync(resolve(dirname(__filename), 'emphasis.module.css'), 'utf8')
    // Compositor-only pulse: opacity + transform, ~1.5s.
    expect(css).toContain('@keyframes needsYouPulse')
    expect(css).toMatch(/animation:\s*needsYouPulse\s+1\.5s/)
    expect(css).toMatch(/opacity:\s*0\.78/)
    expect(css).toMatch(/scale\(1\.015\)/)
    // The accessibility floor: reduced-motion removes the pulse.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/animation:\s*none/)
  })
})
