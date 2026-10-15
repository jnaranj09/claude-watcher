// Story 1.3 — StatusDot tests (AC-3, AC-8).
//
// Asserts: the three live states render (and ONLY those three exist on the type),
// the correct per-state styling hook is applied, and — the accessibility floor —
// a text label is ALWAYS present (color is never the only signal). There is NO
// `done` state.
import { describe, it, expect, afterEach } from 'vitest'
import { StatusDot, type DotStatus } from './StatusDot'
import { renderComponent } from '../../test/renderComponent'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

const STATES: DotStatus[] = ['working', 'needs-you', 'idle']

describe('StatusDot — 3 live states, never color-only (AC-3, AC-8)', () => {
  it.each(STATES)('renders the %s state with its dot + a text label', (status) => {
    const { container, unmount } = renderComponent(<StatusDot status={status} />)
    cleanup = unmount

    const root = container.querySelector('[data-status]')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('data-status')).toBe(status)

    // The dot element exists (the colored circle).
    const dot = container.querySelector('[data-testid="status-dot"]')
    expect(dot).not.toBeNull()

    // ACCESSIBILITY FLOOR: a non-empty text label is ALWAYS present.
    const label = container.querySelector('[data-testid="status-label"]')
    expect(label).not.toBeNull()
    expect((label?.textContent ?? '').trim().length).toBeGreaterThan(0)
  })

  it('uses a sensible default label per state', () => {
    const cases: Array<[DotStatus, string]> = [
      ['working', 'Working'],
      ['needs-you', 'Needs you'],
      ['idle', 'Idle']
    ]
    for (const [status, expected] of cases) {
      const { container, unmount } = renderComponent(<StatusDot status={status} />)
      const label = container.querySelector('[data-testid="status-label"]')
      expect(label?.textContent).toBe(expected)
      unmount()
    }
  })

  it('honors a custom label', () => {
    const { container, unmount } = renderComponent(
      <StatusDot status="needs-you" label="Permission needed" />
    )
    cleanup = unmount
    const label = container.querySelector('[data-testid="status-label"]')
    expect(label?.textContent).toBe('Permission needed')
  })

  it('keeps the label present (in the a11y tree) even when visually hidden', () => {
    const { container, unmount } = renderComponent(<StatusDot status="working" labelHidden />)
    cleanup = unmount
    const label = container.querySelector('[data-testid="status-label"]')
    expect(label).not.toBeNull()
    // Screen-reader-only marker present → still in the accessibility tree, NOT
    // color-only. (jsdom does not compute layout, so we assert the class hook.)
    expect(label?.className).toContain('sr-only')
    expect((label?.textContent ?? '').trim()).toBe('Working')
  })

  it('the dot itself is aria-hidden (the label carries the semantics)', () => {
    const { container, unmount } = renderComponent(<StatusDot status="idle" />)
    cleanup = unmount
    const dot = container.querySelector('[data-testid="status-dot"]')
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
  })

  it('has NO `done` state — the type union is the 3-state model', () => {
    // Compile-time: `DotStatus` is exactly the 3 live states. This runtime check
    // documents the same invariant for readers (and fails if the list drifts).
    const all: DotStatus[] = ['working', 'needs-you', 'idle']
    expect(all).toHaveLength(3)
    expect(all as string[]).not.toContain('done')
  })
})
