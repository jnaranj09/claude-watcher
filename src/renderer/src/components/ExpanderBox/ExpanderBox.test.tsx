// Shortcut expander — the box (jsdom). The pure expand step has its own tests; this covers the
// input, the list, the highlight, and the three exits (expand / Escape / focus out).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ExpanderBox } from './ExpanderBox'
import type { Shortcut } from '../../../../shared/schemas/shortcut'

function sc(alias: string, text: string, name = alias): Shortcut {
  return { id: `id-${alias}`, name, alias, text, workspaceId: null }
}
const LIST = [sc('ht', 'work on help desk ticket $1', 'help desk'), sc('dp', 'deploy $1 to $2')]

let onExpand: ReturnType<typeof vi.fn<(value: string) => void>>
let onClose: ReturnType<typeof vi.fn<() => void>>
let cleanup: (() => void) | undefined

beforeEach(() => {
  onExpand = vi.fn<(value: string) => void>()
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
function press(key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
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

  it('never hands a control character to onExpand', () => {
    render()
    type('ht 1234')
    press('Enter')
    const value = onExpand.mock.calls[0]?.[0] as string
    expect(/[\p{Cc}]/u.test(value)).toBe(false)
  })
})
