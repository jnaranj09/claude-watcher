// The feedback callout (spec 2026-10-01-feedback-callout-design.md): one in-page message for a
// success or an error. Its text is the words only — the icon is drawn in CSS.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Callout } from './Callout'

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
})

function root(): HTMLElement {
  const found = r?.container.querySelector<HTMLElement>('[data-callout]')
  if (found === null || found === undefined) throw new Error('no callout')
  return found
}

describe('Callout', () => {
  it('success is a status, danger an alert; announce={false} drops the role', () => {
    r = renderComponent(<Callout tone="success" title="Saved." />)
    expect(root().getAttribute('role')).toBe('status')
    r.unmount()
    r = renderComponent(<Callout tone="danger" title="No." />)
    expect(root().getAttribute('role')).toBe('alert')
    r.unmount()
    r = renderComponent(<Callout tone="danger" title="No." announce={false} />)
    expect(root().hasAttribute('role')).toBe(false)
  })

  it('its text is the words only (the icon is CSS)', () => {
    r = renderComponent(<Callout tone="danger" title="Could not save." testId="c" />)
    expect(r.container.querySelector('[data-testid="c"]')?.textContent).toBe('Could not save.')
  })

  it('exposes tone and size for themes; compact drops detail and action', () => {
    r = renderComponent(
      <Callout tone="success" size="compact" title="Saved" detail="x" action={<i>a</i>} />
    )
    expect(root().dataset.calloutTone).toBe('success')
    expect(root().dataset.calloutSize).toBe('compact')
    expect(root().textContent).toBe('Saved')
  })

  it('block renders the detail and the action', () => {
    r = renderComponent(<Callout tone="danger" title="T" detail="D" action={<i>A</i>} />)
    expect(root().dataset.calloutSize).toBe('block')
    expect(root().textContent).toBe('TDA')
  })

  it('the stylesheet draws the bar, the tinted fill, both glyphs, and honours reduced motion', () => {
    const css = readFileSync(join(__dirname, 'Callout.module.css'), 'utf8')
    expect(css).toMatch(/border-left:\s*3px solid var\(--callout-bar\)/)
    expect(css).toMatch(/--callout-fill:\s*var\(--success-fill\)/)
    expect(css).toMatch(/--callout-fill:\s*var\(--danger-fill\)/)
    expect(css).toMatch(/content:\s*'✓'/)
    expect(css).toMatch(/content:\s*'!'/)
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
  })
})
