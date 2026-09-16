// The project's ONE multi-line text field — TextInput's sibling. jsdom `unit` project,
// `renderComponent` harness (no @testing-library/react in this repo — Story 1.3).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { TextArea, type TextAreaProps } from './TextArea'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<TextAreaProps> = {}): RenderResult {
  const r = renderComponent(
    <TextArea value="hi" onChange={vi.fn()} testId="area" ariaLabel="Area" {...props} />
  )
  cleanup = r.unmount
  return r
}

function area(r: RenderResult): HTMLTextAreaElement {
  const el = r.container.querySelector<HTMLTextAreaElement>('[data-testid="area"]')
  if (el === null) throw new Error('missing text area')
  return el
}

describe('TextArea', () => {
  it('renders a textarea with the value and reports edits as text', () => {
    const onChange = vi.fn()
    const r = render({ onChange })
    expect(area(r).value).toBe('hi')

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    act(() => {
      setter?.call(area(r), 'hi there')
      area(r).dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('hi there')
  })

  it('takes id / ariaLabel / placeholder / maxLength / rows / invalid / disabled', () => {
    const r = render({
      id: 'x',
      placeholder: 'p',
      maxLength: 5,
      rows: 6,
      invalid: true,
      disabled: true
    })
    const el = area(r)
    expect(el.id).toBe('x')
    expect(el.getAttribute('aria-label')).toBe('Area')
    expect(el.placeholder).toBe('p')
    expect(el.maxLength).toBe(5)
    expect(el.rows).toBe(6)
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(el.disabled).toBe(true)
  })

  it('leaves aria-invalid off while the value is accepted', () => {
    const r = render()
    expect(area(r).hasAttribute('aria-invalid')).toBe(false)
  })
})

// Read off disk on purpose: `vitest.config.ts` sets no `css` option, so importing a *.module.css
// yields a proxy that answers EVERY key with a string — an assertion on `styles.x` can never fail
// (.claude/rules/design.md).
describe('the multi-line box', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/TextArea/TextArea.module.css'),
    'utf8'
  )

  it('is TextInput’s box (same border, background, placeholder colour), and it grows downward', () => {
    const rule = /\n\.textArea \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('border: 1px solid var(--border-strong);')
    expect(rule).toContain('background: var(--bg-surface);')
    // Vertical only: a horizontal drag would break the form column it sits in.
    expect(rule).toContain('resize: vertical;')
    expect(/\.textArea::placeholder\s*\{([^}]*)\}/.exec(css)?.[1]).toContain(
      'var(--text-secondary)'
    )
  })
})
