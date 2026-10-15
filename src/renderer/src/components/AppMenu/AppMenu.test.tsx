// The header ☰ menu (2026-09-14): the ONE header control besides + New session. Settings…,
// Shortcuts…, a Tags › submenu holding Manage tags… / Manage rules…, and a Sessions › submenu —
// ALWAYS the last row (spec 2026-10-03 A). jsdom `unit`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { AppMenu, type AppMenuProps } from './AppMenu'
import { MOTION_EXIT_MS } from '../../styles/motion'
import { pointerInput } from '../../test/pointerInput'

let cleanup: (() => void) | undefined
let clearInput: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  clearInput?.()
  clearInput = undefined
  vi.useRealTimers()
})

function render(props: Partial<AppMenuProps> = {}): RenderResult {
  const r = renderComponent(
    <AppMenu
      onOpenSettings={vi.fn()}
      onOpenShortcuts={vi.fn()}
      onManageTags={vi.fn()}
      onManageRules={vi.fn()}
      onOpenSessions={vi.fn()}
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
const sessionsMenu = (r: RenderResult): HTMLElement | null => q(r, 'app-menu-sessions-list')
/** A row's name without its decorative (aria-hidden) icon. */
const rowName = (el: Element): string => {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
  return copy.textContent ?? ''
}
/** The rows of ONE menu level — the submenu's rows sit inside the main menu's DOM, so skip them. */
const labels = (menu: Element | null): string[] =>
  [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])]
    .filter((el) => el.closest('[role="menu"]') === menu)
    .map(rowName)

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

  it('opens Settings…, Shortcuts…, Tags and Sessions, both as closed submenus', () => {
    const r = render()
    click(q(r, 'app-menu'))
    expect(q(r, 'app-menu')?.getAttribute('aria-expanded')).toBe('true')
    expect(labels(mainMenu(r))).toEqual(['Settings…', 'Shortcuts…', 'Tags', 'Sessions'])
    for (const id of ['app-menu-tags', 'app-menu-sessions']) {
      expect(q(r, id)?.getAttribute('aria-haspopup')).toBe('menu')
      expect(q(r, id)?.getAttribute('aria-expanded')).toBe('false')
    }
    expect(subMenu(r)).toBeNull()
    expect(sessionsMenu(r)).toBeNull()
  })

  it('draws one line icon set: an svg in every icon slot, no ⚙ or ⌨ text', () => {
    const r = render()
    click(q(r, 'app-menu'))
    const icon = (id: string): Element | null =>
      q(r, id)?.querySelector(':scope > [aria-hidden="true"]') ?? null
    for (const id of [
      'app-menu-settings',
      'app-menu-shortcuts',
      'app-menu-tags',
      'app-menu-sessions'
    ]) {
      expect(icon(id)?.querySelector('svg'), id).not.toBeNull()
    }
    expect(q(r, 'app-menu-list')?.textContent).not.toMatch(/[⚙⌨]/)
  })

  it('marks each submenu row with › (they still open to the left)', () => {
    const r = render()
    click(q(r, 'app-menu'))
    for (const id of ['app-menu-tags', 'app-menu-sessions']) {
      expect(q(r, id)?.textContent, id).toContain('›')
      expect(q(r, id)?.textContent, id).not.toContain('‹')
    }
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

  it('Sessions is the LAST row, keeps the clock icon and opens its submenu', () => {
    const r = render()
    click(q(r, 'app-menu'))
    const all = labels(mainMenu(r))
    expect(all[all.length - 1]).toBe('Sessions')
    expect(
      q(r, 'app-menu-sessions')?.querySelector(':scope > [aria-hidden="true"] svg')
    ).not.toBeNull()
    click(q(r, 'app-menu-sessions'))
    expect(sessionsMenu(r)?.getAttribute('aria-label')).toBe('Sessions')
    expect(labels(sessionsMenu(r))).toEqual([
      'Active sessions…',
      'Past sessions…',
      'Templates…',
      'Import session…'
    ])
  })

  it.each([
    ['active', 'Active sessions…'],
    ['past', 'Past sessions…'],
    ['templates', 'Templates…'],
    ['import', 'Import session…']
  ] as const)(
    '%s: its row (%s) closes both menus and opens the Sessions dialog on that page',
    (page, label) => {
      const onOpenSessions = vi.fn()
      const r = render({ onOpenSessions })
      click(q(r, 'app-menu'))
      click(q(r, 'app-menu-sessions'))
      expect(q(r, `sessions-menu-${page}`)?.textContent).toBe(label)
      click(q(r, `sessions-menu-${page}`))
      expect(onOpenSessions).toHaveBeenCalledWith(page)
      expect(mainMenu(r)).toBeNull()
    }
  )

  it('offers no Sessions row when nobody handles it', () => {
    const r = renderComponent(
      <AppMenu onOpenSettings={vi.fn()} onOpenShortcuts={vi.fn()} onManageTags={vi.fn()} />
    )
    cleanup = r.unmount
    click(q(r, 'app-menu'))
    expect(labels(mainMenu(r))).toEqual(['Settings…', 'Shortcuts…', 'Tags'])
  })

  it('only one submenu is open: pointing at Sessions closes Tags, and the other way round', () => {
    const r = render()
    click(q(r, 'app-menu'))
    hover(q(r, 'app-menu-tags'))
    hover(q(r, 'app-menu-sessions'))
    expect(subMenu(r)).toBeNull()
    expect(sessionsMenu(r)).not.toBeNull()
    hover(q(r, 'app-menu-tags'))
    expect(sessionsMenu(r)).toBeNull()
    expect(subMenu(r)).not.toBeNull()
  })

  it('clicking Sessions after pointing at it keeps its submenu open', () => {
    const r = render()
    click(q(r, 'app-menu'))
    hover(q(r, 'app-menu-sessions'))
    click(q(r, 'app-menu-sessions'))
    expect(sessionsMenu(r)).not.toBeNull()
  })

  it('ArrowRight on Sessions opens on its first row; ArrowLeft and Escape go back to Sessions', () => {
    const r = render()
    click(q(r, 'app-menu'))
    act(() => q(r, 'app-menu-sessions')?.focus())
    key(q(r, 'app-menu-sessions'), 'ArrowRight')
    expect(document.activeElement).toBe(q(r, 'sessions-menu-active'))
    key(q(r, 'sessions-menu-active'), 'ArrowLeft')
    expect(sessionsMenu(r)).toBeNull()
    expect(document.activeElement).toBe(q(r, 'app-menu-sessions'))
    key(q(r, 'app-menu-sessions'), 'ArrowRight')
    key(q(r, 'sessions-menu-active'), 'Escape')
    expect(sessionsMenu(r)).toBeNull()
    expect(mainMenu(r)).not.toBeNull()
    expect(document.activeElement).toBe(q(r, 'app-menu-sessions'))
  })

  // A key-opened Tags submenu must not make a later HOVER-opened Sessions submenu grab focus.
  it('hover-opening a submenu never moves focus into it', () => {
    const r = render()
    click(q(r, 'app-menu'))
    act(() => q(r, 'app-menu-tags')?.focus())
    key(q(r, 'app-menu-tags'), 'ArrowRight')
    hover(q(r, 'app-menu-sessions'))
    expect(document.activeElement).not.toBe(q(r, 'sessions-menu-past'))
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

  it('draws the menu and the Tags submenu with Popover; the open submenu row reads as expanded', () => {
    const r = render()
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    expect(mainMenu(r)?.hasAttribute('data-popover')).toBe(true)
    const tags = q(r, 'app-menu-tags')
    expect(tags?.hasAttribute('data-popover-item')).toBe(true)
    expect(tags?.getAttribute('aria-expanded')).toBe('true')
    expect(subMenu(r)?.hasAttribute('data-popover')).toBe(true)
    // The submenu sits INSIDE the menu box, which therefore must not scroll (Popover.surface).
    expect(subMenu(r)?.closest('[data-testid="app-menu-list"]')).not.toBeNull()
  })

  it('pins the wrappers placement in the stylesheet (jsdom has no layout)', () => {
    const css = readFileSync('src/renderer/src/components/AppMenu/AppMenu.module.css', 'utf8')
    const rule = (sel: string): string =>
      new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    const menu = rule('.menuWrap')
    expect(menu).toMatch(/position:\s*absolute/)
    expect(menu).toMatch(/top:\s*calc\(100% \+ var\(--space-1\)\)/)
    expect(menu).toMatch(/right:\s*0/)
    const sub = rule('.submenuWrap')
    expect(sub).toMatch(/position:\s*absolute/)
    expect(sub).toMatch(/top:\s*calc\(-1 \* var\(--space-2\) - 1px\)/)
    expect(sub).toMatch(/right:\s*calc\(100% \+ var\(--space-2\) \+ var\(--space-1\)\)/)
    expect(rule('.subAnchor')).toMatch(/position:\s*relative/)
  })
})

describe('AppMenu — overlay motion (spec 2026-10-04 §4)', () => {
  it('a pointer close keeps the open submenu inside the fading menu, then both go', () => {
    clearInput = pointerInput()
    vi.useFakeTimers()
    const r = render()
    click(q(r, 'app-menu'))
    click(q(r, 'app-menu-tags'))
    expect(q(r, 'app-menu-tags-list')).not.toBeNull()
    click(q(r, 'app-menu')) // toggle closed with the pointer
    expect(q(r, 'app-menu-list')?.hasAttribute('data-leaving')).toBe(true)
    expect(q(r, 'app-menu-tags-list')?.hasAttribute('data-leaving')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS)
    })
    expect(q(r, 'app-menu-list')).toBeNull()
    click(q(r, 'app-menu')) // re-open: no submenu left over
    expect(q(r, 'app-menu-tags-list')).toBeNull()
  })
})
