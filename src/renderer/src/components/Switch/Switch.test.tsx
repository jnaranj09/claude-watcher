// The on/off control for SETTINGS (spec 2026-10-07 A.6). A native checkbox underneath, so Space,
// `<label htmlFor>` and the change event come from the browser; only the look is ours.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useState, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Switch } from './Switch'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function Harness({ onChange }: { onChange: (v: boolean) => void }): JSX.Element {
  const [on, setOn] = useState(false)
  return (
    <>
      <label htmlFor="sw">Sound</label>
      <Switch
        id="sw"
        testId="sw"
        checked={on}
        onChange={(v) => {
          onChange(v)
          setOn(v)
        }}
      />
    </>
  )
}

function render(onChange = vi.fn()): RenderResult {
  const r = renderComponent(<Harness onChange={onChange} />)
  cleanup = r.unmount
  return r
}
const input = (r: RenderResult): HTMLInputElement => {
  const el = r.container.querySelector<HTMLInputElement>('[data-testid="sw"]')
  if (el === null) throw new Error('missing switch')
  return el
}

describe('Switch', () => {
  it('is a native checkbox with role="switch" (Space and the label come from the browser)', () => {
    const el = input(render())
    expect(el.tagName).toBe('INPUT')
    expect(el.type).toBe('checkbox')
    expect(el.getAttribute('role')).toBe('switch')
    expect(el.id).toBe('sw')
  })

  it('aria-checked follows checked; a click hands onChange the new boolean', () => {
    const onChange = vi.fn()
    const r = render(onChange)
    expect(input(r).getAttribute('aria-checked')).toBe('false')
    act(() => input(r).click())
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(input(r).getAttribute('aria-checked')).toBe('true')
  })

  it('a click on its label toggles it', () => {
    const onChange = vi.fn()
    const r = render(onChange)
    act(() => r.container.querySelector('label')?.click())
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('draws a 34×20 glass switch: lit when on, never the native blue', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Switch/Switch.module.css'),
      'utf8'
    )
    const body = (sel: string): string =>
      new RegExp(`\\n${sel.replace(/[.:()]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    expect(body('.switch')).toMatch(/appearance: none;/)
    expect(body('.switch')).toMatch(/width: 34px;/)
    expect(body('.switch')).toMatch(/height: 20px;/)
    expect(body('.switch')).toMatch(/background-color: var\(--bg-surface-raised\);/)
    expect(body('.switch')).toMatch(/border: 1px solid var\(--border-strong\);/)
    expect(body('.switch:checked')).toMatch(/background-color: var\(--text-primary\);/)
    expect(body('.switch:checked')).toMatch(/var\(--text-on-lit\)/)
    expect(body('.switch:focus-visible')).toMatch(
      /outline: var\(--focus-ring-width\) solid var\(--focus-ring\);/
    )
  })
})
