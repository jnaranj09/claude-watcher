import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { NewSessionButton } from './NewSessionButton'
import { templatesStore } from '../../stores/templatesStore'
import type { Template } from '../../../../shared/ipc/contract'

const T1: Template = {
  id: 'a',
  name: 'api',
  cwd: '/api',
  model: null,
  permissionMode: null,
  effort: null
}
let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => templatesStore.getState().hydrate([]))
})
function render(): {
  r: RenderResult
  onPickFolder: ReturnType<typeof vi.fn>
  onPickTemplate: ReturnType<typeof vi.fn>
  onManage: ReturnType<typeof vi.fn>
} {
  const props = { onPickFolder: vi.fn(), onPickTemplate: vi.fn(), onManage: vi.fn() }
  act(() => templatesStore.getState().hydrate([T1]))
  const r = renderComponent(<NewSessionButton {...props} />)
  cleanup = r.unmount
  return { r, ...props }
}
const button = (r: RenderResult): HTMLButtonElement =>
  r.container.querySelector('[data-testid="header-new-session"]') as HTMLButtonElement
const menu = (r: RenderResult): Element | null =>
  r.container.querySelector('[data-testid="new-session-menu"]')

describe('NewSessionButton', () => {
  it('closed by default; click opens the menu with the store templates; click again closes', () => {
    const { r } = render()
    expect(menu(r)).toBeNull()
    act(() => button(r).click())
    expect(menu(r)).not.toBeNull()
    expect(button(r).getAttribute('aria-expanded')).toBe('true')
    expect(r.container.querySelectorAll('[data-testid="menu-template"]')).toHaveLength(1)
    act(() => button(r).click())
    expect(menu(r)).toBeNull()
  })
  it('picking a template closes the menu and forwards it', () => {
    const { r, onPickTemplate } = render()
    act(() => button(r).click())
    act(() => (r.container.querySelector('[data-template-id="a"]') as HTMLButtonElement).click())
    expect(onPickTemplate).toHaveBeenCalledWith(T1)
    expect(menu(r)).toBeNull()
  })
  it('folder / manage close the menu and forward', () => {
    const { r, onPickFolder, onManage } = render()
    act(() => button(r).click())
    act(() =>
      (r.container.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    expect(onPickFolder).toHaveBeenCalledTimes(1)
    expect(menu(r)).toBeNull()
    act(() => button(r).click())
    act(() =>
      (r.container.querySelector('[data-testid="menu-manage"]') as HTMLButtonElement).click()
    )
    expect(onManage).toHaveBeenCalledTimes(1)
    expect(menu(r)).toBeNull()
  })
  it('testId overrides the default header id (the empty board renders it as "new-session")', () => {
    const props = { onPickFolder: vi.fn(), onPickTemplate: vi.fn(), onManage: vi.fn() }
    const r = renderComponent(<NewSessionButton {...props} testId="new-session" />)
    cleanup = r.unmount
    expect(r.container.querySelector('[data-testid="header-new-session"]')).toBeNull()
    const btn = r.container.querySelector('[data-testid="new-session"]') as HTMLButtonElement
    expect(btn.textContent).toContain('+ New session')
    act(() => btn.click())
    expect(menu(r)).not.toBeNull()
  })
  it('a mousedown outside closes; Escape closes and returns focus to the button', () => {
    const { r } = render()
    act(() => button(r).click())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu(r)).toBeNull()
    act(() => button(r).click())
    act(() => {
      menu(r)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu(r)).toBeNull()
    expect(document.activeElement).toBe(button(r))
  })
})

// ── Session-templates parity — the `dead` variant (the dead-terminal pane) ──────────
// The terminal frame is `overflow: clip` and `.dead` opens a stacking context at z-index 12
// (EmbeddedTerminal.module.css), so this variant's popover is PORTALED to document.body.
// These tests pin the two things the portal puts at risk: where the menu lands, and the
// outside-click containment (the portaled menu is NOT a descendant of the anchor).
describe('NewSessionButton — dead variant (portaled placement)', () => {
  function renderDead(): {
    r: RenderResult
    onPickFolder: ReturnType<typeof vi.fn>
    onPickTemplate: ReturnType<typeof vi.fn>
    onManage: ReturnType<typeof vi.fn>
  } {
    const props = { onPickFolder: vi.fn(), onPickTemplate: vi.fn(), onManage: vi.fn() }
    act(() => templatesStore.getState().hydrate([T1]))
    const r = renderComponent(
      <NewSessionButton {...props} variant="dead" testId="dead-new-session" />
    )
    cleanup = r.unmount
    return { r, ...props }
  }
  const deadButton = (r: RenderResult): HTMLButtonElement =>
    r.container.querySelector('[data-testid="dead-new-session"]') as HTMLButtonElement
  const bodyMenu = (): Element | null =>
    document.body.querySelector('[data-testid="new-session-menu"]')

  it('renders the menu into document.body, NOT inside the anchor (escapes the frame clip)', () => {
    const { r } = renderDead()
    act(() => deadButton(r).click())
    // The anchor holds ONLY the button — an in-anchor menu would be clipped by the frame.
    expect(r.container.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    const portaled = bodyMenu()
    expect(portaled).not.toBeNull()
    expect(r.container.contains(portaled)).toBe(false)
    // …and it is the real menu, fed from the templates store.
    expect(document.body.querySelectorAll('[data-testid="menu-template"]')).toHaveLength(1)
    expect(deadButton(r).getAttribute('aria-expanded')).toBe('true')
  })

  it('a mousedown INSIDE the portaled menu does NOT close it (containment covers the portal)', () => {
    const { r } = renderDead()
    act(() => deadButton(r).click())
    const search = document.body.querySelector('[data-testid="menu-search"]') as HTMLElement
    expect(search).not.toBeNull()
    // The premise of this test: the menu is OUTSIDE the anchor subtree. An anchor-only
    // containment check therefore reads this mousedown as "outside" and closes the menu.
    expect(r.container.contains(search)).toBe(false)
    act(() => {
      search.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(bodyMenu()).not.toBeNull()
  })

  it('a mousedown outside closes; Escape closes and returns focus to the button', () => {
    const { r } = renderDead()
    act(() => deadButton(r).click())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(bodyMenu()).toBeNull()
    act(() => deadButton(r).click())
    act(() => {
      bodyMenu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(bodyMenu()).toBeNull()
    expect(document.activeElement).toBe(deadButton(r))
  })

  it('the three seams fire and close the menu', () => {
    const { r, onPickFolder, onPickTemplate, onManage } = renderDead()
    act(() => deadButton(r).click())
    act(() =>
      (document.body.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    expect(onPickFolder).toHaveBeenCalledTimes(1)
    expect(bodyMenu()).toBeNull()

    act(() => deadButton(r).click())
    act(() => (document.body.querySelector('[data-template-id="a"]') as HTMLButtonElement).click())
    expect(onPickTemplate).toHaveBeenCalledWith(T1)
    expect(bodyMenu()).toBeNull()

    act(() => deadButton(r).click())
    act(() =>
      (document.body.querySelector('[data-testid="menu-manage"]') as HTMLButtonElement).click()
    )
    expect(onManage).toHaveBeenCalledTimes(1)
    expect(bodyMenu()).toBeNull()
  })

  it('the default (header) variant still renders the menu INSIDE the anchor — no portal leak', () => {
    const props = { onPickFolder: vi.fn(), onPickTemplate: vi.fn(), onManage: vi.fn() }
    const r = renderComponent(<NewSessionButton {...props} />)
    cleanup = r.unmount
    act(() =>
      (r.container.querySelector('[data-testid="header-new-session"]') as HTMLButtonElement).click()
    )
    expect(r.container.querySelector('[data-testid="new-session-menu"]')).not.toBeNull()
  })
})
