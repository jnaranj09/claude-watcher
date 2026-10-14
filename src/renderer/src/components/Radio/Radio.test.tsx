// The radio button (one choice of a group, today the workspace colour). A native radio underneath,
// so the arrow keys, the group and the change event come from the browser; only the look is ours.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Radio } from './Radio'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(jsx: JSX.Element): RenderResult {
  const r = renderComponent(jsx)
  cleanup = r.unmount
  return r
}
const radio = (r: RenderResult, id: string): HTMLInputElement => {
  const el = r.container.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)
  if (el === null) throw new Error(`missing ${id}`)
  return el
}
const css = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/Radio/Radio.module.css'),
  'utf8'
)
const body = (sel: string): string =>
  new RegExp(`\\n${sel.replace(/[.:()+]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('Radio', () => {
  it('is a native radio of its group, named by ariaLabel; picking it calls onChange', () => {
    const onChange = vi.fn()
    const r = render(
      <div>
        <Radio testId="a" name="g" value="a" ariaLabel="red" checked onChange={vi.fn()} />
        <Radio testId="b" name="g" value="b" ariaLabel="blue" checked={false} onChange={onChange} />
      </div>
    )
    const b = radio(r, 'b')
    expect(b.type).toBe('radio')
    expect(b.name).toBe('g')
    expect(b.value).toBe('b')
    expect(b.getAttribute('aria-label')).toBe('blue')
    expect(radio(r, 'a').checked).toBe(true)
    act(() => b.click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('draws a 14px circle, lit when picked, never the native blue', () => {
    expect(body('.dot')).toMatch(/appearance: none;/)
    expect(body('.dot')).toMatch(/width: 14px;/)
    expect(body('.dot')).toMatch(/height: 14px;/)
    expect(body('.dot')).toMatch(/margin: 0;/)
    expect(body('.dot')).toMatch(/border-radius: 50%;/)
    expect(body('.dot')).toMatch(/border: 1px solid var\(--border-strong\);/)
    expect(body('.dot')).toMatch(/background-color: var\(--bg-surface-raised\);/)
    // Lit: the --text-primary fill as a ring round a --text-on-lit centre.
    expect(body('.dot:checked')).toMatch(/background-color: var\(--text-on-lit\);/)
    expect(body('.dot:checked')).toMatch(/border-color: var\(--text-primary\);/)
    expect(body('.dot:checked')).toMatch(/box-shadow: inset 0 0 0 3px var\(--text-primary\);/)
    expect(body('.dot:focus-visible')).toMatch(
      /outline: var\(--focus-ring-width\) solid var\(--focus-ring\);/
    )
  })
})
