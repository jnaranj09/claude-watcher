// Story 1.3 — ColumnHeader tests (AC-5).
//
// Asserts: renders with `count: 0` (does NOT collapse); the accent tick follows
// `accent` (gold / blue / idle-muted); prominent (hero) vs flank presentations
// differ. `count` is a prop, never computed here.
import { describe, it, expect, afterEach } from 'vitest'
import { ColumnHeader, type ColumnAccent } from './ColumnHeader'
import { renderComponent } from '../../test/renderComponent'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('ColumnHeader — always present, accent tick, prominent/flank (AC-5)', () => {
  it('renders name + count even when the column is EMPTY (count 0; never collapses)', () => {
    const { container, unmount } = renderComponent(
      <ColumnHeader name="Needs you" count={0} accent="needs-you" />
    )
    cleanup = unmount
    // The header element exists and shows the name + the zero count.
    expect(container.querySelector('[data-accent]')).not.toBeNull()
    expect(container.querySelector('[data-testid="column-name"]')?.textContent).toBe('Needs you')
    expect(container.querySelector('[data-testid="column-count"]')?.textContent).toContain('0')
  })

  it('shows a non-zero live count', () => {
    const { container, unmount } = renderComponent(
      <ColumnHeader name="Needs you" count={2} accent="needs-you" />
    )
    cleanup = unmount
    expect(container.querySelector('[data-testid="column-count"]')?.textContent).toContain('2')
  })

  it('the accent tick follows `accent` (working / needs-you / idle all differ)', () => {
    const classes = (['working', 'needs-you', 'idle'] as ColumnAccent[]).map((accent) => {
      const r = renderComponent(<ColumnHeader name="X" count={1} accent={accent} />)
      const root = r.container.querySelector('[data-accent]')
      expect(root?.getAttribute('data-accent')).toBe(accent)
      const cls = root?.className ?? ''
      r.unmount()
      return cls
    })
    // All three accent variants produce DISTINCT class strings (distinct ticks).
    expect(new Set(classes).size).toBe(3)
  })

  it('prominent (hero) and flank presentations differ', () => {
    const hero = renderComponent(
      <ColumnHeader name="Needs you" count={1} accent="needs-you" prominent />
    )
    const heroRoot = hero.container.querySelector('[data-prominent]')
    expect(heroRoot?.getAttribute('data-prominent')).toBe('true')
    const heroClass = heroRoot?.className ?? ''
    hero.unmount()

    const flank = renderComponent(<ColumnHeader name="Needs you" count={1} accent="needs-you" />)
    const flankRoot = flank.container.querySelector('[data-prominent]')
    expect(flankRoot?.getAttribute('data-prominent')).toBe('false')
    const flankClass = flankRoot?.className ?? ''
    flank.unmount()

    expect(heroClass).not.toBe(flankClass)
  })
})
