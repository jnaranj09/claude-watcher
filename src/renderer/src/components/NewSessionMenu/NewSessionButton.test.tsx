import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { NewSessionButton } from './NewSessionButton'
import { templatesStore } from '../../stores/templatesStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import type { Template } from '../../../../shared/ipc/contract'

const T1: Template = {
  id: 'a',
  name: 'api',
  cwd: '/api',
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
  act(() => templatesStore.getState().hydrate([]))
  act(() =>
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  )
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
// Portaled to document.body (useAnchoredPlacement).
const menu = (): Element | null => document.querySelector('[data-testid="new-session-menu"]')

describe('NewSessionButton', () => {
  it('closed by default; click opens the menu with the store templates; click again closes', () => {
    const { r } = render()
    expect(menu()).toBeNull()
    act(() => button(r).click())
    expect(menu()).not.toBeNull()
    expect(button(r).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('[data-testid="menu-template"]')).toHaveLength(1)
    act(() => button(r).click())
    expect(menu()).toBeNull()
  })
  it('picking a template closes the menu and forwards it', () => {
    const { r, onPickTemplate } = render()
    act(() => button(r).click())
    act(() => (document.querySelector('[data-template-id="a"]') as HTMLButtonElement).click())
    expect(onPickTemplate).toHaveBeenCalledWith(T1)
    expect(menu()).toBeNull()
  })
  it('folder / manage close the menu and forward', () => {
    const { r, onPickFolder, onManage } = render()
    act(() => button(r).click())
    act(() =>
      (document.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    expect(onPickFolder).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
    act(() => button(r).click())
    act(() => (document.querySelector('[data-testid="menu-manage"]') as HTMLButtonElement).click())
    expect(onManage).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })
  it('testId overrides the default header id (the empty board renders it as "new-session")', () => {
    const props = { onPickFolder: vi.fn(), onPickTemplate: vi.fn(), onManage: vi.fn() }
    const r = renderComponent(<NewSessionButton {...props} testId="new-session" />)
    cleanup = r.unmount
    expect(r.container.querySelector('[data-testid="header-new-session"]')).toBeNull()
    const btn = r.container.querySelector('[data-testid="new-session"]') as HTMLButtonElement
    expect(btn.textContent).toContain('+ New session')
    act(() => btn.click())
    expect(menu()).not.toBeNull()
  })
  it('a mousedown outside closes; Escape closes and returns focus to the button', () => {
    const { r } = render()
    act(() => button(r).click())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).toBeNull()
    act(() => button(r).click())
    act(() => {
      menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button(r))
  })

  // Task 11 review Finding 3 — the ONE test that pins this component to
  // makeSelectVisibleTemplates: reverting to the unfiltered selectTemplates leaves every other
  // test in this file green (their fixtures are all workspaceId: null), so this is the only
  // wiring proof the popover has.
  it('lists only Global + the active workspace templates, never another workspace’s', () => {
    const G: Template = { ...T1, id: 'g', workspaceId: null }
    const OWN: Template = { ...T1, id: 'own', workspaceId: 'w1' }
    const OTHER: Template = { ...T1, id: 'other', workspaceId: 'w2' }
    act(() => {
      workspacesStore.setState({ activeId: 'w1', workspaces: [], loaded: true })
      templatesStore.getState().hydrate([G, OWN, OTHER])
    })
    const r = renderComponent(
      <NewSessionButton onPickFolder={vi.fn()} onPickTemplate={vi.fn()} onManage={vi.fn()} />
    )
    cleanup = r.unmount
    act(() => button(r).click())
    const ids = Array.from(document.querySelectorAll('[data-testid="menu-template"]')).map((el) =>
      el.getAttribute('data-template-id')
    )
    expect(ids.sort()).toEqual(['g', 'own'])
  })
})

// ── Portaled placement — every variant, tested on the `dead` one (the dead-terminal pane) ──
// The terminal frame is `overflow: clip` and the empty board's button sits low, so the popover is
// PORTALED to document.body in every variant (useAnchoredPlacement).
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
  const bodyMenu = (): Element | null => document.querySelector('[data-testid="new-session-menu"]')

  it('renders the menu into document.body, NOT inside the anchor (escapes the frame clip)', () => {
    const { r } = renderDead()
    act(() => deadButton(r).click())
    // The anchor holds ONLY the button — an in-anchor menu would be clipped by the frame.
    expect(r.container.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    const portaled = bodyMenu()
    expect(portaled).not.toBeNull()
    expect(r.container.contains(portaled)).toBe(false)
    // …and it is the real menu, fed from the templates store.
    expect(document.querySelectorAll('[data-testid="menu-template"]')).toHaveLength(1)
    expect(deadButton(r).getAttribute('aria-expanded')).toBe('true')
  })

  it('a mousedown INSIDE the portaled menu does NOT close it (containment covers the portal)', () => {
    const { r } = renderDead()
    act(() => deadButton(r).click())
    const search = document.querySelector('[data-testid="menu-search"]') as HTMLElement
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
      (document.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    expect(onPickFolder).toHaveBeenCalledTimes(1)
    expect(bodyMenu()).toBeNull()

    act(() => deadButton(r).click())
    act(() => (document.querySelector('[data-template-id="a"]') as HTMLButtonElement).click())
    expect(onPickTemplate).toHaveBeenCalledWith(T1)
    expect(bodyMenu()).toBeNull()

    act(() => deadButton(r).click())
    act(() => (document.querySelector('[data-testid="menu-manage"]') as HTMLButtonElement).click())
    expect(onManage).toHaveBeenCalledTimes(1)
    expect(bodyMenu()).toBeNull()
  })

  it('the default (header) variant portals too — the menu is in document.body, not the anchor', () => {
    const props = { onPickFolder: vi.fn(), onPickTemplate: vi.fn(), onManage: vi.fn() }
    const r = renderComponent(<NewSessionButton {...props} />)
    cleanup = r.unmount
    act(() =>
      (r.container.querySelector('[data-testid="header-new-session"]') as HTMLButtonElement).click()
    )
    expect(r.container.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    expect(document.querySelector('[data-testid="new-session-menu"]')).not.toBeNull()
  })
})
