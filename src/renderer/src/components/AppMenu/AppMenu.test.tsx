// The header ☰ menu (2026-09-14): the ONE header control besides + New session. Settings…,
// Shortcuts…, and a Tags ▸ submenu holding Manage tags… / Manage rules…. jsdom `unit`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { AppMenu, type AppMenuProps } from './AppMenu'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<AppMenuProps> = {}): RenderResult {
  const r = renderComponent(
    <AppMenu
      onOpenSettings={vi.fn()}
      onOpenShortcuts={vi.fn()}
      onManageTags={vi.fn()}
      onManageRules={vi.fn()}
      {...props}
    />
  )
  cleanup = r.unmount
  return r
}

const q = (r: RenderResult, testId: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())
const key = (el: Element | null, k: string): void => {
  if (el === null) throw new Error('no element to press a key on')
  fireEvent(el, new KeyboardEvent('keydown', { key: k, bubbles: true }))
}
const hover = (el: Element | null): void => {
  if (el === null) throw new Error('no element to hover')
  fireEvent(el, new MouseEvent('mouseover', { bubbles: true }))
}
const mainMenu = (r: RenderResult): HTMLElement | null => q(r, 'app-menu-list')
const subMenu = (r: RenderResult): HTMLElement | null => q(r, 'app-menu-tags-list')
/** The rows of ONE menu level — the submenu's rows sit inside the main menu's DOM, so skip them. */
const labels = (menu: Element | null): string[] =>
  [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])]
    .filter((el) => el.closest('[role="menu"]') === menu)
    .map((el) => el.textContent ?? '')

describe('AppMenu', () => {
  it('is an icon-only button named "Menu"', () => {
    const r = render()
    const button = q(r, 'app-menu')
    expect(button?.getAttribute('aria-label')).toBe('Menu')
    expect(button?.getAttribute('title')).toBe('Menu')
    expect(button?.getAttribute('aria-haspopup')).toBe('menu')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.textContent).toBe('')
    expect(button?.querySelector('svg')).not.toBeNull()
  })

  it('opens Settings…, Shortcuts… and Tags, with Tags as a closed submenu', () => {
    const r = render()
    click(q(r, 'app-menu'))
    expect(q(r, 'app-menu')?.getAttribute('aria-expanded')).toBe('true')
    expect(labels(mainMenu(r))).toEqual(['Settings…', 'Shortcuts…', 'Tags'])
    const tags = q(r, 'app-menu-tags')
    expect(tags?.getAttribute('aria-haspopup')).toBe('menu')
    expect(tags?.getAttribute('aria-expanded')).toBe('false')
    expect(subMenu(r)).toBeNull()
  })

  it('Settings… closes the menu and calls onOpenSettings', () => {
    const onOpenSettings = vi.fn()
    const r = render({ onOpenSettings })
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-settings'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(mainMenu(r)).toBeNull()
  })

  it('Shortcuts… closes the menu and calls onOpenShortcuts', () => {
    const onOpenShortcuts = vi.fn()
    const r = render({ onOpenShortcuts })
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-shortcuts'))
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1)
    expect(mainMenu(r)).toBeNull()
  })

  it('Tags opens the tags submenu: Manage tags… and Manage rules…', () => {
    const r = render()
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    expect(q(r, 'app-menu-tags')?.getAttribute('aria-expanded')).toBe('true')
    expect(subMenu(r)?.getAttribute('aria-label')).toBe('Tags')
    expect(labels(subMenu(r))).toEqual(['Manage tags…', 'Manage rules…'])
  })

  // A mouse points at a row before it clicks it: the pointer opens the submenu, and the click that
  // follows must not toggle it shut again.
  it('clicking Tags after pointing at it keeps the submenu open', () => {
    const r = render()
    click(q(r, 'app-menu'))
    hover(q(r, 'app-menu-tags'))
    click(q(r, 'app-menu-tags'))
    expect(subMenu(r)).not.toBeNull()
    expect(q(r, 'app-menu-tags')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('pointing at Tags opens the submenu; pointing at another row closes it', () => {
    const r = render()
    click(q(r, 'app-menu'))
    hover(q(r, 'app-menu-tags'))
    expect(subMenu(r)).not.toBeNull()
    hover(q(r, 'app-menu-shortcuts'))
    expect(subMenu(r)).toBeNull()
  })

  it('Manage tags… closes both menus and calls onManageTags', () => {
    const onManageTags = vi.fn()
    const r = render({ onManageTags })
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    click(q(r, 'tags-menu-manage-tags'))
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(mainMenu(r)).toBeNull()
    expect(subMenu(r)).toBeNull()
  })

  it('Manage rules… closes both menus and calls onManageRules', () => {
    const onManageRules = vi.fn()
    const r = render({ onManageRules })
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    click(q(r, 'tags-menu-manage-rules'))
    expect(onManageRules).toHaveBeenCalledTimes(1)
    expect(mainMenu(r)).toBeNull()
  })

  it('offers no Manage rules… row when nobody handles it', () => {
    const r = renderComponent(
      <AppMenu onOpenSettings={vi.fn()} onOpenShortcuts={vi.fn()} onManageTags={vi.fn()} />
    )
    cleanup = r.unmount
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    expect(labels(subMenu(r))).toEqual(['Manage tags…'])
  })

  it('ArrowRight on Tags opens the submenu on its first row; ArrowLeft goes back to Tags', () => {
    const r = render()
    click(q(r, 'app-menu'))
    act(() => q(r, 'app-menu-tags')?.focus())
    key(q(r, 'app-menu-tags'), 'ArrowRight')
    expect(document.activeElement).toBe(q(r, 'tags-menu-manage-tags'))
    key(q(r, 'tags-menu-manage-tags'), 'ArrowLeft')
    expect(subMenu(r)).toBeNull()
    expect(mainMenu(r)).not.toBeNull()
    expect(document.activeElement).toBe(q(r, 'app-menu-tags'))
  })

  it('Escape in the submenu closes only the submenu, stops there, and focuses Tags', () => {
    const r = render()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    key(q(r, 'tags-menu-manage-tags'), 'Escape')
    document.removeEventListener('keydown', outer)
    expect(subMenu(r)).toBeNull()
    expect(mainMenu(r)).not.toBeNull()
    expect(outer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(q(r, 'app-menu-tags'))
  })

  it('Escape in the menu closes it, stops there, and puts focus back on the button', () => {
    const r = render()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    click(q(r, 'app-menu'))
    key(q(r, 'app-menu-settings'), 'Escape')
    document.removeEventListener('keydown', outer)
    expect(mainMenu(r)).toBeNull()
    expect(outer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(q(r, 'app-menu'))
  })

  // A mouse click leaves focus on the button, not in the menu — Escape must still close it.
  it('Escape closes the menu while focus is still on the button', () => {
    const r = render()
    click(q(r, 'app-menu'))
    key(q(r, 'app-menu'), 'Escape')
    expect(mainMenu(r)).toBeNull()
  })

  // Closed, the menu has nothing to peel: Escape must reach the app (Focused → Board).
  it('with the menu closed, Escape on the button passes through', () => {
    const r = render()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    key(q(r, 'app-menu'), 'Escape')
    document.removeEventListener('keydown', outer)
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('a mousedown outside closes the menu and its submenu', () => {
    const r = render()
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(mainMenu(r)).toBeNull()
    expect(subMenu(r)).toBeNull()
  })
})
