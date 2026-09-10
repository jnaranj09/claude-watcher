// The project's ONE dropdown. jsdom `unit` project, `renderComponent` harness (no
// @testing-library/react in this repo — Story 1.3).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Select, type SelectOption } from './Select'

const OPTIONS: SelectOption<'a' | 'b' | 'c'>[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
]

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(
  onChange: (v: 'a' | 'b' | 'c') => void = vi.fn(),
  value: 'a' | 'b' | 'c' = 'b'
): RenderResult {
  const r = renderComponent(
    <Select
      value={value}
      options={OPTIONS}
      onChange={onChange}
      ariaLabel="Letter"
      testId="letter"
    />
  )
  cleanup = r.unmount
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

describe('Select', () => {
  it('shows the selected option and opens nothing until asked', () => {
    const r = render()
    const trigger = q<HTMLButtonElement>(r, '[data-testid="letter"]')
    expect(trigger.textContent).toContain('Beta')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(r.container.querySelector('[data-testid="letter-list"]')).toBeNull()
  })

  it('picks an option, reports it, and closes', () => {
    const onChange = vi.fn()
    const r = render(onChange)
    click(q(r, '[data-testid="letter"]'))
    click(q(r, '[data-testid="letter-option-c"]'))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(r.container.querySelector('[data-testid="letter-list"]')).toBeNull()
  })

  // The a11y contract a native <select> gave for free and this component has to earn: the popup
  // is a listbox, every row is an option, and the CURRENT one is marked as selected — not just
  // painted differently.
  it('marks the current value for assistive tech, not only with a colour', () => {
    const r = render()
    click(q(r, '[data-testid="letter"]'))
    expect(q(r, '[data-testid="letter-list"]').getAttribute('role')).toBe('listbox')
    expect(q(r, '[data-testid="letter-option-b"]').getAttribute('aria-selected')).toBe('true')
    expect(q(r, '[data-testid="letter-option-a"]').getAttribute('aria-selected')).toBe('false')
  })

  // UX-DR14: Escape peels ONE layer. These dropdowns live inside modal dialogs whose own Escape
  // handler closes them, so an Escape that bubbles would shut the dialog out from under the
  // operator who only meant to dismiss the list.
  it('closes on Escape without letting it reach the dialog behind', () => {
    const onDialogEscape = vi.fn()
    const r = renderComponent(
      <div onKeyDown={onDialogEscape}>
        <Select value="b" options={OPTIONS} onChange={vi.fn()} ariaLabel="Letter" testId="letter" />
      </div>
    )
    cleanup = r.unmount
    click(q(r, '[data-testid="letter"]'))
    key(q(r, '[data-testid="letter-list"]'), 'Escape')
    expect(r.container.querySelector('[data-testid="letter-list"]')).toBeNull()
    expect(onDialogEscape).not.toHaveBeenCalled()
    // Focus goes back to the trigger — otherwise it lands on <body> and the next Tab restarts
    // from the top of the dialog.
    expect(document.activeElement).toBe(q(r, '[data-testid="letter"]'))
  })

  it('closes when the pointer goes down outside it', () => {
    const r = render()
    click(q(r, '[data-testid="letter"]'))
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(r.container.querySelector('[data-testid="letter-list"]')).toBeNull()
  })

  // Replacing a native <select> means replacing its keyboard too. Opening focuses the CURRENT
  // row so the arrows start where the operator already is.
  it('opens on ArrowDown with the current row focused, and the arrows walk from there', () => {
    const r = render()
    key(q(r, '[data-testid="letter"]'), 'ArrowDown')
    expect(document.activeElement).toBe(q(r, '[data-testid="letter-option-b"]'))
    key(q(r, '[data-testid="letter-list"]'), 'ArrowDown')
    expect(document.activeElement).toBe(q(r, '[data-testid="letter-option-c"]'))
    // Wraps, the way a listbox does.
    key(q(r, '[data-testid="letter-list"]'), 'ArrowDown')
    expect(document.activeElement).toBe(q(r, '[data-testid="letter-option-a"]'))
    key(q(r, '[data-testid="letter-list"]'), 'End')
    expect(document.activeElement).toBe(q(r, '[data-testid="letter-option-c"]'))
    key(q(r, '[data-testid="letter-list"]'), 'Home')
    expect(document.activeElement).toBe(q(r, '[data-testid="letter-option-a"]'))
  })

  it('will not open while disabled', () => {
    const r = renderComponent(
      <Select
        value="b"
        options={OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Letter"
        testId="letter"
        disabled
      />
    )
    cleanup = r.unmount
    click(q(r, '[data-testid="letter"]'))
    expect(r.container.querySelector('[data-testid="letter-list"]')).toBeNull()
  })
})
