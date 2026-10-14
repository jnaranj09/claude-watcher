// Shortcut expander — the box (jsdom). The pure expand step has its own tests; this covers the
// input, the list, the highlight, and the three exits (expand / Escape / focus out).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ExpanderBox } from './ExpanderBox'
import type { Shortcut } from '../../../../shared/schemas/shortcut'

function sc(alias: string, text: string, name = alias): Shortcut {
  return { id: `id-${alias}`, name, alias, text, workspaceId: null, favorite: false }
}
const LIST = [sc('ht', 'work on help desk ticket $1', 'help desk'), sc('dp', 'deploy $1 to $2')]

type OnExpand = (value: string) => { code: 'multiline_unsupported' } | null
let onExpand: ReturnType<typeof vi.fn<OnExpand>>
let onClose: ReturnType<typeof vi.fn<() => void>>
let cleanup: (() => void) | undefined

beforeEach(() => {
  onExpand = vi.fn<OnExpand>(() => null)
  onClose = vi.fn<() => void>()
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(list: readonly Shortcut[] = LIST): RenderResult {
  const r = renderComponent(<ExpanderBox shortcuts={list} onExpand={onExpand} onClose={onClose} />)
  cleanup = r.unmount
  return r
}
function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`)
}
function input(): HTMLInputElement {
  return byTestId('expander-input') as HTMLInputElement
}
function type(value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    input().dispatchEvent(e)
  })
  return e
}
function optionAliases(): string[] {
  return [...document.querySelectorAll('[data-testid^="expander-option-"]')].map(
    (el) => el.getAttribute('data-testid')?.replace('expander-option-', '') ?? ''
  )
}
function highlighted(): string | null {
  return (
    document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-testid') ??
    null
  )
}

describe('ExpanderBox', () => {
  it('focuses the input on open and lists every shortcut', () => {
    render()
    expect(document.activeElement).toBe(input())
    expect(optionAliases()).toEqual(['ht', 'dp'])
    expect(highlighted()).toBe('expander-option-ht')
  })

  it('is a Popover box with an inline list of compact rows; the highlight is data-active', () => {
    render()
    const box = byTestId('expander-box')
    expect(box?.hasAttribute('data-popover')).toBe(true)
    const list = box?.querySelector('[role="listbox"]')
    expect(list?.hasAttribute('data-popover-list')).toBe(true)
    expect(list?.hasAttribute('data-popover')).toBe(false)
    const rows = [...(list?.querySelectorAll('[data-popover-item]') ?? [])]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.hasAttribute('data-active')).toBe(true)
    expect(rows[1]?.hasAttribute('data-active')).toBe(false)
    expect(rows.every((r) => r.getAttribute('data-density') === 'compact')).toBe(true)
    expect(rows.every((r) => r.getAttribute('tabindex') === '-1')).toBe(true)
  })

  it('keeps focus in the input when a row is pressed', () => {
    render()
    input().focus()
    const row = byTestId('expander-option-dp') as HTMLElement
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      row.dispatchEvent(e)
    })
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('expander-input')
    expect(highlighted()).toBe('expander-option-dp')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the wrapper keeps the placement, z-index and list cap in its stylesheet', () => {
    const css = readFileSync(
      'src/renderer/src/components/ExpanderBox/ExpanderBox.module.css',
      'utf8'
    )
    const wrap = /\.wrap\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(wrap).toMatch(/position:\s*absolute/)
    expect(wrap).toMatch(/top:\s*var\(--space-3\)/)
    expect(wrap).toMatch(/left:\s*50%/)
    expect(wrap).toMatch(/translateX\(-50%\)/)
    expect(wrap).toMatch(/z-index:\s*12/)
    expect(wrap).toMatch(/--popover-max-height:\s*240px/)
  })

  it('filters on the FIRST word only', () => {
    render()
    type('dp api')
    expect(optionAliases()).toEqual(['dp'])
  })

  it('shows one line when nothing matches', () => {
    render()
    type('zzz')
    expect(optionAliases()).toEqual([])
    expect(byTestId('expander-empty')?.textContent).toBe('No shortcut matches')
  })

  it('Enter on an empty query does nothing — it must not expand the top row', () => {
    // The top row here takes NO values (unlike LIST's own rows), so a naive "expand the
    // highlighted row" on empty input would succeed and type it — the exact bug this guards.
    render([sc('hi', 'hello there'), ...LIST])
    press('Enter')
    expect(onExpand).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(byTestId('expander-box')).not.toBeNull()
  })

  it('Enter expands with the highlighted row and the typed values', () => {
    render()
    type('h 1234')
    press('Enter')
    expect(onExpand).toHaveBeenCalledWith('work on help desk ticket 1234')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ArrowDown / ArrowUp move the highlight and wrap', () => {
    render()
    press('ArrowDown')
    expect(highlighted()).toBe('expander-option-dp')
    press('ArrowDown')
    expect(highlighted()).toBe('expander-option-ht')
    press('ArrowUp')
    expect(highlighted()).toBe('expander-option-dp')
  })

  it('a changed query resets the highlight to the top', () => {
    render()
    press('ArrowDown')
    type('d')
    expect(highlighted()).toBe('expander-option-dp')
    type('')
    expect(highlighted()).toBe('expander-option-ht')
  })

  it('a missing value shows the error line and keeps the box open', () => {
    render()
    type('dp api')
    press('Enter')
    expect(onExpand).not.toHaveBeenCalled()
    const err = byTestId('expander-error')
    expect(err?.getAttribute('role')).toBe('alert')
    expect(err?.textContent).toBe('Missing value for $2')
    expect(err?.getAttribute('data-callout-tone')).toBe('danger')
    expect(err?.getAttribute('data-callout-size')).toBe('compact')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('typing after an error clears the error line', () => {
    render()
    type('dp api')
    press('Enter')
    type('dp api staging')
    expect(byTestId('expander-error')).toBeNull()
  })

  it('an unknown alias with no rows is an error', () => {
    render()
    type('zzz 1')
    press('Enter')
    expect(byTestId('expander-error')?.textContent).toBe('No shortcut named "zzz"')
  })

  it('Escape closes without expanding and stops propagating', () => {
    render()
    const seen = vi.fn()
    document.body.addEventListener('keydown', seen)
    press('Escape')
    document.body.removeEventListener('keydown', seen)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onExpand).not.toHaveBeenCalled()
    expect(seen).not.toHaveBeenCalled()
  })

  it('focus leaving the box closes it; focus moving inside does not', () => {
    render()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => {
      input().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    outside.remove()
    cleanup?.()

    onClose.mockClear()
    render()
    const row = byTestId('expander-option-ht')
    act(() => {
      input().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: row }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('fails closed when a typed value carries a control character (never hands it to onExpand)', () => {
    render()
    type('ht \u001b[31mred')
    press('Enter')
    expect(onExpand).not.toHaveBeenCalled()
    expect(byTestId('expander-error')?.textContent).toBe('A value contains a control character')
  })

  it('Tab completes the highlighted alias, keeps the values and keeps focus in the box', () => {
    render()
    type('d 12')
    const e = press('Tab')
    expect(e.defaultPrevented).toBe(true)
    expect(input().value).toBe('dp 12')
    expect(document.activeElement).toBe(input())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Tab completes the row moved to with the arrows', () => {
    render()
    press('ArrowDown')
    press('Tab')
    expect(input().value).toBe('dp ')
    expect(highlighted()).toBe('expander-option-dp')
  })

  it('Tab with no match and Shift+Tab change nothing and keep focus', () => {
    render()
    type('zzz')
    expect(press('Tab').defaultPrevented).toBe(true)
    expect(input().value).toBe('zzz')
    type('d')
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(input().value).toBe('d')
  })

  it("shows the highlighted row's usage under the list", () => {
    render()
    expect(byTestId('expander-usage')?.textContent).toContain('ht $1')
    press('ArrowDown')
    expect(byTestId('expander-usage')?.textContent).toContain('dp $1 $2')
    type('zzz')
    expect(byTestId('expander-usage')).toBeNull()
  })

  it('a phrase the terminal refuses shows the error line and keeps the box open', () => {
    onExpand.mockReturnValue({ code: 'multiline_unsupported' })
    render()
    type('ht 1')
    press('Enter')
    expect(byTestId('expander-error')?.textContent).toBe(
      'This session cannot take a multi-line phrase'
    )
  })
})

describe('ExpanderBox — favorites', () => {
  const star = (alias: string): Shortcut => ({ ...sc(alias, 'x'), favorite: true })

  it('lists favorites first on an empty query', () => {
    render([sc('aa', 'x'), star('zz')])
    expect(optionAliases()).toEqual(['zz', 'aa'])
  })
  it('a favorite never rises above an exact alias match', () => {
    render([sc('ap', 'x'), star('apx')])
    type('ap')
    expect(optionAliases()).toEqual(['ap', 'apx'])
  })
  it('marks a favorite row for assistive tech, with a hidden star', () => {
    render([star('zz')])
    const row = byTestId('expander-option-zz')
    expect(row?.querySelector('.sr-only')?.textContent).toBe('Favorite')
    expect(row?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
  it('a plain row has no mark', () => {
    render([sc('aa', 'x')])
    expect(byTestId('expander-option-aa')?.textContent).not.toContain('Favorite')
    expect(byTestId('expander-option-aa')?.querySelector('svg')).toBeNull()
  })
})
