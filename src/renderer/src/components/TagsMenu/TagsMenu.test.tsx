// The header tags menu (2026-09-14): an icon-only button beside ⚙ and ⌨ that opens Manage tags… /
// Manage rules…. It filters nothing — the filter lives in the board's FilterBar. jsdom `unit`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { TagsMenu } from './TagsMenu'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(
  onManageTags = vi.fn(),
  onManageRules: (() => void) | null = vi.fn()
): RenderResult {
  const r = renderComponent(
    onManageRules === null ? (
      <TagsMenu onManageTags={onManageTags} />
    ) : (
      <TagsMenu onManageTags={onManageTags} onManageRules={onManageRules} />
    )
  )
  cleanup = r.unmount
  return r
}

const q = (r: RenderResult, testId: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())
const menu = (r: RenderResult): Element | null => r.container.querySelector('[role="menu"]')

describe('TagsMenu', () => {
  it('is an icon-only button named "Tags and rules"', () => {
    const r = render()
    const button = q(r, 'tags-menu')
    expect(button?.getAttribute('aria-label')).toBe('Tags and rules')
    expect(button?.getAttribute('title')).toBe('Tags and rules')
    expect(button?.getAttribute('aria-haspopup')).toBe('menu')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.textContent).toBe('')
    expect(button?.querySelector('svg')).not.toBeNull()
  })

  it('opens a menu with Manage tags… and Manage rules…', () => {
    const r = render()
    click(q(r, 'tags-menu'))
    expect(q(r, 'tags-menu')?.getAttribute('aria-expanded')).toBe('true')
    expect(
      [...(menu(r)?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent)
    ).toEqual(['Manage tags…', 'Manage rules…'])
  })

  it('Manage tags… closes the menu and calls onManageTags', () => {
    const onManageTags = vi.fn()
    const r = render(onManageTags)
    click(q(r, 'tags-menu'))
    click(q(r, 'tags-menu-manage-tags'))
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(menu(r)).toBeNull()
  })

  it('Manage rules… closes the menu and calls onManageRules', () => {
    const onManageRules = vi.fn()
    const r = render(vi.fn(), onManageRules)
    click(q(r, 'tags-menu'))
    click(q(r, 'tags-menu-manage-rules'))
    expect(onManageRules).toHaveBeenCalledTimes(1)
    expect(menu(r)).toBeNull()
  })

  it('offers no Manage rules… row when nobody handles it', () => {
    const r = render(vi.fn(), null)
    click(q(r, 'tags-menu'))
    expect(q(r, 'tags-menu-manage-rules')).toBeNull()
  })

  it('Escape closes the menu, stops there, and puts focus back on the button', () => {
    const r = render()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    click(q(r, 'tags-menu'))
    const list = menu(r)
    if (list === null) throw new Error('menu did not open')
    fireEvent(list, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.removeEventListener('keydown', outer)
    expect(menu(r)).toBeNull()
    expect(outer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(q(r, 'tags-menu'))
  })

  it('a mousedown outside closes the menu', () => {
    const r = render()
    click(q(r, 'tags-menu'))
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu(r)).toBeNull()
  })
})
