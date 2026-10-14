// Story 1.3 — ColumnHeader tests (AC-5).
//
// Asserts: renders with `count: 0` (does NOT collapse); the accent tick follows
// `accent` (gold / blue / idle-muted); prominent (hero) vs flank presentations
// differ. `count` is a prop, never computed here.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('ColumnHeader — theme hooks (spec 2026-10-08 C)', () => {
  it('renders the theme hooks without changing what Default shows', () => {
    const { container, unmount } = renderComponent(
      <ColumnHeader name="Idle" count={3} accent="idle" />
    )
    cleanup = unmount
    const root = container.querySelector('[data-column-header]')
    expect(root).not.toBeNull()
    expect(root?.querySelector('[data-column-mark]')?.getAttribute('aria-hidden')).toBe('true')
    const count = container.querySelector('[data-testid="column-count"]')
    expect(count?.querySelector('[data-count-sep]')?.textContent).toBe('·')
    expect(count?.textContent?.replace(/\s+/g, ' ').trim()).toBe('· 3')
  })
})

describe('ColumnHeader — one height in every column (spec 2026-10-07 A.1)', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/ColumnHeader/ColumnHeader.module.css'),
    'utf8'
  )
  const body = (sel: string): string =>
    new RegExp(`\\n${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  it('every header carries the same bottom padding and a 1px bottom border', () => {
    expect(body('.root')).toMatch(/padding-bottom: var\(--inset-compact-x\);/)
    expect(body('.root')).toMatch(/border-bottom: 1px solid transparent;/)
    expect(body('.prominent')).toMatch(/border-bottom-color: var\(--border\);/)
    expect(body('.prominent')).not.toMatch(/padding|border-bottom:/)
  })
  it('the name line has ONE fixed line height, so the bold hero name is not taller', () => {
    expect(body('.name')).toMatch(/line-height: 20px;/)
    expect(body('.prominent .name')).not.toMatch(/line-height/)
    expect(body('.flank .name')).not.toMatch(/line-height/)
  })
})

describe('ColumnHeader — public theme hooks', () => {
  it('exposes the label and the count to themes', () => {
    const { container, unmount } = renderComponent(
      <ColumnHeader name="Needs you" count={2} accent="needs-you" prominent />
    )
    cleanup = unmount
    expect(container.querySelector('[data-column-label]')?.textContent).toBe('Needs you')
    expect(container.querySelector('[data-count="needs-you"]')?.textContent).toContain('2')
  })

  it('counts a non-needs-you column as a total', () => {
    const { container, unmount } = renderComponent(
      <ColumnHeader name="Working" count={4} accent="working" />
    )
    cleanup = unmount
    expect(container.querySelector('[data-count="total"]')?.textContent).toContain('4')
  })
})
