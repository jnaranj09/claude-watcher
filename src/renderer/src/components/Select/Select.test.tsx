// The project's ONE dropdown. jsdom `unit` project, `renderComponent` harness (no
// @testing-library/react in this repo — Story 1.3).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Select, type SelectOption } from './Select'
import { MOTION_EXIT_MS } from '../../styles/motion'
import { pointerInput } from '../../test/pointerInput'

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

/** Searches the whole document: the open list is portaled to document.body. `r` keeps the call
 *  sites naming the render they mean. */
function q<T extends Element>(_r: RenderResult, sel: string): T {
  const el = document.querySelector<T>(sel)
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
    expect(document.querySelector('[data-testid="letter-list"]')).toBeNull()
  })

  it('picks an option, reports it, and closes', () => {
    const onChange = vi.fn()
    const r = render(onChange)
    click(q(r, '[data-testid="letter"]'))
    click(q(r, '[data-testid="letter-option-c"]'))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(document.querySelector('[data-testid="letter-list"]')).toBeNull()
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
    expect(document.querySelector('[data-testid="letter-list"]')).toBeNull()
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
    expect(document.querySelector('[data-testid="letter-list"]')).toBeNull()
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
    expect(document.querySelector('[data-testid="letter-list"]')).toBeNull()
  })

  // A trigger at the right edge of a scroll region (the Settings rows): a left-aligned popup wider
  // than a short value ran past the pane and was clipped. `align="end"` pins it to the right edge.
  it('lines the popup up with the trigger END when asked', () => {
    const r = renderComponent(
      <Select
        value="b"
        options={OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Letter"
        testId="letter"
        align="end"
      />
    )
    cleanup = r.unmount
    click(q(r, '[data-testid="letter"]'))
    // The placement sits on the wrapper around the Popover surface, inline (useAnchoredPlacement).
    const wrapperOf = (el: Element): HTMLElement => el.parentElement?.parentElement as HTMLElement
    const end = wrapperOf(q(r, '[data-testid="letter-list"]')).style
    expect(end.right).not.toBe('')
    expect(end.left).toBe('')
    cleanup()
    const s = render()
    click(q(s, '[data-testid="letter"]'))
    const start = wrapperOf(q(s, '[data-testid="letter-list"]')).style
    expect(start.left).not.toBe('')
    expect(start.right).toBe('')
  })

  // The bug: the list was drawn inside the trigger's box, so a scroll region (the Settings pane)
  // or the window bottom cut it. It is portaled out, and opens UPWARD, capped to the room above,
  // when the room below is too small.
  it('portals the list out of its container and opens it upward near the window bottom', () => {
    const r = render()
    const trigger = q<HTMLButtonElement>(r, '[data-testid="letter"]')
    const bottom = window.innerHeight - 10
    trigger.getBoundingClientRect = () =>
      ({ top: bottom - 30, bottom, left: 40, right: 140, width: 100, height: 30 }) as DOMRect
    click(trigger)
    const list = q(r, '[data-testid="letter-list"]')
    expect(r.container.contains(list)).toBe(false)
    const wrap = (list.parentElement?.parentElement as HTMLElement).style
    expect(wrap.top).toBe('')
    expect(wrap.bottom).toBe(`${window.innerHeight - (bottom - 30) + 4}px`)
    expect(wrap.maxHeight).toBe(`${bottom - 30 - 4 - 16}px`)
    expect(wrap.minWidth).toBe('100px')
  })

  // A workspace dropdown draws the name in its tint (WorkspaceLabel) instead of plain text. The
  // label stays the option's text for tests and assistive tech.
  // spec 2026-10-03 G: a tint box never sits inside the dropdown box. The open list keeps
  // `display` (a workspace is still found by colour when choosing); the closed trigger is plain.
  it('draws `display` in the open list only; the closed trigger shows the plain label', () => {
    const opts: SelectOption<'a' | 'b'>[] = [
      { value: 'a', label: 'Alpha', display: <em data-testid="shown-a">Alpha</em> },
      { value: 'b', label: 'Beta' }
    ]
    const r = renderComponent(
      <Select value="a" options={opts} onChange={vi.fn()} ariaLabel="Letter" testId="letter" />
    )
    cleanup = r.unmount
    const trigger = q(r, '[data-testid="letter"]')
    expect(trigger.querySelector('[data-testid="shown-a"]')).toBeNull()
    expect(trigger.textContent).toContain('Alpha')
    click(trigger)
    const row = q(r, '[data-testid="letter-option-a"]')
    expect(row.querySelector('[data-testid="shown-a"]')).not.toBeNull()
    expect(q(r, '[data-testid="letter-option-b"]').textContent).toBe('Beta')
  })

  it('draws its list with Popover and marks the current value by aria-selected', () => {
    const r = render()
    click(q(r, '[data-testid="letter"]'))
    const list = q(r, '[data-testid="letter-list"]')
    expect(list.getAttribute('role')).toBe('listbox')
    expect(list.closest('[data-popover]')).not.toBeNull()
    const b = q(r, '[data-testid="letter-option-b"]')
    expect(b.hasAttribute('data-popover-item')).toBe(true)
    expect(b.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the wrapper fixed above dialogs, a flex box, and caps the list height', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Select/Select.module.css'),
      'utf8'
    )
    // Fixed (placed from JS), over ManageDialog (60) and under toasts (70); a flex column so the
    // inline maxHeight reaches the list.
    expect(css).toMatch(
      /\.listWrap\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*65;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*--popover-max-height:\s*244px;/
    )
    expect(css).toMatch(/\.listWrap > \[data-popover\]\s*\{[^}]*min-height:\s*0;/)
  })
})

describe('Select — the list fades out after a pointer pick (spec 2026-10-04 §4)', () => {
  it('keeps the list leaving for MOTION_EXIT_MS, then removes it', () => {
    const clearInput = pointerInput()
    vi.useFakeTimers()
    const r = render()
    click(q(r, '[data-testid="letter"]'))
    click(q(r, '[data-testid="letter-option-a"]'))
    expect(q(r, '[data-popover]').hasAttribute('data-leaving')).toBe(true)
    // Its positioned wrapper too, or a click where the list was lands on the wrapper.
    expect(q(r, '[data-popover]').parentElement?.hasAttribute('inert')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS)
    })
    expect(document.querySelector('[data-popover]')).toBeNull()
    vi.useRealTimers()
    clearInput()
  })
})
