// The checkbox that SELECTS things (row checks, Select all, Include global). A native checkbox
// underneath, so Space, the label and the change event come from the browser; only the look is ours.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useState, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Checkbox } from './Checkbox'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function Harness({
  onChange,
  indeterminate = false
}: {
  onChange: (v: boolean) => void
  indeterminate?: boolean
}): JSX.Element {
  const [on, setOn] = useState(false)
  return (
    <Checkbox
      testId="cb"
      label="Select all"
      checked={on}
      indeterminate={indeterminate}
      onChange={(v) => {
        onChange(v)
        setOn(v)
      }}
    />
  )
}

function render(jsx: JSX.Element): RenderResult {
  const r = renderComponent(jsx)
  cleanup = r.unmount
  return r
}
const input = (r: RenderResult): HTMLInputElement => {
  const el = r.container.querySelector<HTMLInputElement>('[data-testid="cb"]')
  if (el === null) throw new Error('missing checkbox')
  return el
}
const css = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/Checkbox/Checkbox.module.css'),
  'utf8'
)
const body = (sel: string): string =>
  new RegExp(`\\n${sel.replace(/[.:()+]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('Checkbox', () => {
  it('is a native checkbox; a click hands onChange the new boolean', () => {
    const onChange = vi.fn()
    const r = render(<Harness onChange={onChange} />)
    expect(input(r).tagName).toBe('INPUT')
    expect(input(r).type).toBe('checkbox')
    act(() => input(r).click())
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(input(r).checked).toBe(true)
  })

  it('its text is its label: a click on the text toggles it', () => {
    const onChange = vi.fn()
    const r = render(<Harness onChange={onChange} />)
    const label = input(r).closest('label')
    expect(label?.textContent).toBe('Select all')
    act(() => label?.querySelector<HTMLElement>(':scope > span:last-child')?.click())
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('with no text, the accessible name is the ariaLabel', () => {
    const r = render(
      <Checkbox testId="cb" ariaLabel="Select api" checked={false} onChange={vi.fn()} />
    )
    expect(input(r).getAttribute('aria-label')).toBe('Select api')
    expect(input(r).closest('label')).toBeNull()
  })

  it('indeterminate is set on the DOM property (it has no attribute)', () => {
    const r = render(<Harness onChange={vi.fn()} indeterminate />)
    expect(input(r).indeterminate).toBe(true)
  })

  it('draws a 14px square, lit when on or mixed, never the native blue', () => {
    expect(body('.square')).toMatch(/appearance: none;/)
    expect(body('.square')).toMatch(/width: 14px;/)
    expect(body('.square')).toMatch(/height: 14px;/)
    expect(body('.square')).toMatch(/background-color: var\(--bg-surface-raised\);/)
    expect(body('.square')).toMatch(/border: 1px solid var\(--border-strong\);/)
    expect(body('.square')).toMatch(/margin: 0;/)
    expect(body('.square:checked,\n.square:indeterminate')).toMatch(
      /background-color: var\(--text-primary\);/
    )
    expect(body('.mark')).toMatch(/color: var\(--text-on-lit\);/)
    expect(body('.square:focus-visible')).toMatch(
      /outline: var\(--focus-ring-width\) solid var\(--focus-ring\);/
    )
  })

  // Hovering the text of a lit box must not draw a grey edge round its --text-primary fill.
  it('the hover edge is for an unlit box only', () => {
    expect(css).not.toMatch(/\n\.labeled:hover \.square[ ,{]/)
    expect(
      body(
        '.square:not(:checked):not(:indeterminate):hover,\n.labeled:hover .square:not(:checked):not(:indeterminate)'
      )
    ).toMatch(/border-color: var\(--text-secondary\);/)
  })

  // On draws the tick, mixed the dash; never both (a checked box can also be indeterminate).
  it('draws the tick only when on and not mixed, the dash only when mixed', () => {
    expect(
      body(
        '.square:checked:not(:indeterminate) + .mark .tick,\n.square:indeterminate + .mark .dash'
      )
    ).toMatch(/display: inline;/)
  })

  // Owner, 2026-10-14: a checkbox is a square in every theme. A theme's `--rounded-sm` can be a
  // pill (Liquid Glass), and a round checkbox reads as a radio button.
  it('keeps square corners whatever the theme sets --rounded-sm to', () => {
    expect(body('.square')).toMatch(/border-radius: 4px;/)
  })

  // Owner, 2026-10-14: the text sits `--gap-field` from its box (design.md, label → its control).
  it('puts its text --gap-field from the box', () => {
    expect(body('.labeled')).toMatch(/gap: var\(--gap-field\);/)
  })
})
