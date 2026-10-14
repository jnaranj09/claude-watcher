import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { NewSessionMenu } from './NewSessionMenu'
import { filterTemplates } from './filterTemplates'
import type { Template } from '../../../../shared/ipc/contract'

const T1: Template = {
  id: 'a',
  name: 'work api',
  cwd: '/home/op/api',
  model: 'opus',
  permissionMode: 'plan',
  effort: 'xhigh',
  workspaceId: null,
  initialPrompt: null,
  params: [],
  favorite: false
}
const T2: Template = {
  id: 'b',
  name: 'blog',
  cwd: '/home/op/blog',
  model: null,
  permissionMode: null,
  effort: null,
  workspaceId: null,
  initialPrompt: null,
  params: [],
  favorite: false
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})
function render(templates: Template[] = [T1, T2]): {
  r: RenderResult
  onPickFolder: ReturnType<typeof vi.fn>
  onPickTemplate: ReturnType<typeof vi.fn>
  onManage: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onToggleFavorite: ReturnType<typeof vi.fn>
} {
  const props = {
    onPickFolder: vi.fn(),
    onPickTemplate: vi.fn(),
    onManage: vi.fn(),
    onClose: vi.fn(),
    onToggleFavorite: vi.fn()
  }
  const r = renderComponent(
    <NewSessionMenu templates={templates} favoriteBusy={false} {...props} />
  )
  cleanup = r.unmount
  return { r, ...props }
}
function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

describe('filterTemplates', () => {
  it('case-insensitive substring on the name; blank query keeps all', () => {
    expect(filterTemplates([T1, T2], '')).toEqual([T1, T2])
    expect(filterTemplates([T1, T2], 'API')).toEqual([T1])
    expect(filterTemplates([T1, T2], 'zzz')).toEqual([])
  })
})

describe('NewSessionMenu', () => {
  it('renders folder row, search (focused), one row per template with name/path/flags, manage row', () => {
    const { r } = render()
    expect(document.activeElement).toBe(q(r, '[data-testid="menu-search"]'))
    const rows = document.querySelectorAll('[data-testid="menu-template"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('work api')
    expect(rows[0]?.textContent).toContain('/home/op/api')
    expect(rows[0]?.textContent).toContain('opus · Plan · Extra high effort')
    expect(q(r, '[data-testid="menu-manage"]')).toBeTruthy()
  })
  it('search filters rows; Enter in the search picks the first match', () => {
    const { r, onPickTemplate } = render()
    type(q(r, '[data-testid="menu-search"]'), 'blo')
    expect(document.querySelectorAll('[data-testid="menu-template"]')).toHaveLength(1)
    key(q(r, '[data-testid="menu-search"]'), 'Enter')
    expect(onPickTemplate).toHaveBeenCalledWith(T2)
  })
  it('Enter with no match picks nothing; the empty line says so', () => {
    const { r, onPickTemplate } = render()
    type(q(r, '[data-testid="menu-search"]'), 'zzz')
    key(q(r, '[data-testid="menu-search"]'), 'Enter')
    expect(onPickTemplate).not.toHaveBeenCalled()
    expect(q(r, '[data-testid="menu-empty"]').textContent).toBe('No matches')
  })
  it('no templates ⇒ "No templates yet"', () => {
    const { r } = render([])
    expect(q(r, '[data-testid="menu-empty"]').textContent).toBe('No templates yet')
  })
  it('Pick a folder… carries a decorative (aria-hidden) folder icon and keeps its label', () => {
    const { r } = render()
    const item = q<HTMLButtonElement>(r, '[data-testid="menu-pick-folder"]')
    const icon = item.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(item.textContent).toBe('Pick a folder…')
  })
  it('clicking a row / folder / manage fires the matching callback', () => {
    const { r, onPickTemplate, onPickFolder, onManage } = render()
    act(() => q<HTMLButtonElement>(r, '[data-template-id="a"]').click())
    expect(onPickTemplate).toHaveBeenCalledWith(T1)
    act(() => q<HTMLButtonElement>(r, '[data-testid="menu-pick-folder"]').click())
    expect(onPickFolder).toHaveBeenCalledTimes(1)
    act(() => q<HTMLButtonElement>(r, '[data-testid="menu-manage"]').click())
    expect(onManage).toHaveBeenCalledTimes(1)
  })
  it('Escape anywhere closes; ArrowDown/ArrowUp walk the items', () => {
    const { r, onClose } = render()
    key(q(r, '[data-testid="menu-search"]'), 'ArrowDown')
    expect(document.activeElement).toBe(q(r, '[data-template-id="a"]'))
    key(q(r, '[data-template-id="a"]'), 'ArrowDown')
    expect(document.activeElement).toBe(q(r, '[data-template-id="b"]'))
    key(q(r, '[data-template-id="b"]'), 'ArrowUp')
    expect(document.activeElement).toBe(q(r, '[data-template-id="a"]'))
    key(q(r, '[data-template-id="a"]'), 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('draws with Popover and keeps roving rows', () => {
    const { r } = render()
    const root = q(r, '[data-testid="new-session-menu"]')
    expect(root.hasAttribute('data-popover')).toBe(true)
    expect(root.getAttribute('role')).toBe('dialog')
    const tpl = q(r, '[data-testid="menu-template"]')
    expect(tpl.hasAttribute('data-popover-item')).toBe(true)
    expect(tpl.hasAttribute('data-menu-item')).toBe(true)
    expect(r.container.querySelectorAll('[data-popover-divider]').length).toBe(2)
  })
  it('keeps the placement rules in the stylesheet', () => {
    const css = readFileSync(
      'src/renderer/src/components/NewSessionMenu/NewSessionMenu.module.css',
      'utf8'
    )
    const menu = /(?:^|\n)\.menu \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(menu).toContain('--popover-max-height: 320px;')
    // Portaled and placed from JS (useAnchoredPlacement): fixed, and a flex box so the inline
    // maxHeight reaches the list.
    const anchor = /\.portalAnchor \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(anchor).toContain('position: fixed;')
    expect(anchor).toContain('display: flex;')
  })
})

describe('NewSessionMenu — favorites', () => {
  const STARRED: Template = { ...T2, favorite: true }
  const ids = (r: RenderResult): (string | null)[] =>
    [...r.container.querySelectorAll('[data-testid="menu-template"]')].map((b) =>
      b.getAttribute('data-template-id')
    )

  it('lists favorites first', () => {
    const { r } = render([T1, STARRED])
    expect(ids(r)).toEqual(['b', 'a'])
  })
  it('empty search + Enter launches the top favorite', () => {
    const { r, onPickTemplate } = render([T1, STARRED])
    key(q(r, '[data-testid="menu-search"]'), 'Enter')
    expect(onPickTemplate).toHaveBeenCalledWith(STARRED)
  })
  it('the star toggles without launching or closing', () => {
    const { r, onPickTemplate, onClose, onToggleFavorite } = render([T1])
    act(() => q<HTMLButtonElement>(r, '[data-testid="menu-favorite-a"]').click())
    expect(onToggleFavorite).toHaveBeenCalledWith(T1)
    expect(onPickTemplate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('the star is never inside the row button', () => {
    const { r } = render([T1])
    const row = q(r, '[data-template-id="a"]')
    expect(row.contains(q(r, '[data-testid="menu-favorite-a"]'))).toBe(false)
  })
  it('arrow keys skip the star buttons', () => {
    const { r } = render([T1, T2])
    const [first, second] = [
      ...r.container.querySelectorAll<HTMLElement>('[data-testid="menu-template"]')
    ]
    act(() => first?.focus())
    key(first as Element, 'ArrowDown')
    expect(document.activeElement).toBe(second)
  })
  // Hidden by OPACITY, never `visibility`/`display`: a hidden star cannot take focus, so Tab
  // could not reach it and the focus restore after a re-sort (FavoriteToggle) would fail.
  it('an off star hides until its row is hovered or focused; an on star always shows', () => {
    const css = readFileSync(join(__dirname, 'NewSessionMenu.module.css'), 'utf8')
    const hide =
      /\.templateRow\[data-favorite-row='off'\]:not\(:hover\):not\(:focus-within\) \.star \{([^}]*)\}/.exec(
        css
      )?.[1] ?? ''
    expect(hide).toMatch(/opacity: 0;/)
    expect(hide).not.toMatch(/visibility|display/)
    const { r } = render([T1, STARRED])
    expect(q(r, '[data-template-id="a"]').parentElement?.getAttribute('data-favorite-row')).toBe(
      'off'
    )
    expect(q(r, '[data-template-id="b"]').parentElement?.getAttribute('data-favorite-row')).toBe(
      'on'
    )
  })
})
