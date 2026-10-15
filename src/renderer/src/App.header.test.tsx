// The header layout — App-level. The workspace switcher sits beside the brand, apart from the
// action buttons, so it reads as "where you are" and not as one more control.
// Fake window bridges from the shared App harness (test/appHarness.ts), no Electron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { q, unmountRendered } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges } from './test/appHarness'
import { themeStore } from './stores/themeStore'
import { THEME_STYLE_ID } from './hooks/useApplyTheme'
import { DEFAULT_THEME_BUNDLE, type ThemeBundle } from '../../shared/schemas/theme'
import { GLASS_FIXTURE } from '../../__fixtures__/glassSpec'

beforeEach(() => {
  resetBoardView()
  stubAppBridges({
    launch: { pickDirectory: vi.fn(() => Promise.resolve('/home/op/project')) },
    shortcuts: {}
  })
})

afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
  // The custom-themes tests install window.themes and drive App's theme:applied listener.
  document.getElementById(THEME_STYLE_ID)?.remove()
  document.documentElement.style.colorScheme = ''
  act(() => themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE))
})

/** The header's direct child that holds `el` — the group it was placed in. */
function headerGroupOf(header: Element, el: Element): Element {
  let group: Element = el
  while (group.parentElement !== header) {
    if (group.parentElement === null) throw new Error('element is not inside the header')
    group = group.parentElement
  }
  return group
}

describe('App — header layout', () => {
  it('places the workspace switcher beside the brand, not among the action buttons', async () => {
    const r = await renderApp()
    const header = q(r, '[data-testid="app-header"]')
    const group = headerGroupOf(header, q(r, '[data-testid="workspace-switcher"]'))
    expect(group.textContent).toContain('Claude Watcher')
    expect(group.contains(q(r, '[data-testid="header-new-session"]'))).toBe(false)
  })
})

describe('custom themes — App wiring', () => {
  it('subscribes to theme:applied, asks for a reload once, and writes the bundle into <head>', async () => {
    const listeners: Array<(b: ThemeBundle) => void> = []
    const reload = vi.fn(() => Promise.resolve({ ok: true, id: 'default' }))
    ;(window as unknown as { themes: unknown }).themes = {
      list: () => Promise.resolve([]),
      reload,
      openFolder: () => Promise.resolve(),
      onApplied: (cb: (b: ThemeBundle) => void) => {
        listeners.push(cb)
        return () => {}
      }
    }
    const r = await renderApp()
    expect(reload).toHaveBeenCalledTimes(1)
    act(() =>
      listeners[0]?.({
        id: 'paper',
        name: 'Paper',
        colorScheme: 'light',
        css: 'body{}',
        terminal: {},
        wallpaperId: null,
        glass: null
      })
    )
    expect(document.getElementById('claude-watcher-theme')?.textContent).toBe('body{}')
    expect(document.documentElement.style.colorScheme).toBe('light')
    r.unmount()
  })

  // The one line that mounts the WebGL glass (review 2026-10-08): a theme with a glass block mounts
  // the layer's canvas; a theme without one removes it and never leaves data-glass-on behind.
  it('mounts the glass layer only while the applied theme has a glass block', async () => {
    const listeners: Array<(b: ThemeBundle) => void> = []
    ;(window as unknown as { themes: unknown }).themes = {
      list: () => Promise.resolve([]),
      reload: () => Promise.resolve({ ok: true, id: 'default' }),
      openFolder: () => Promise.resolve(),
      onApplied: (cb: (b: ThemeBundle) => void) => {
        listeners.push(cb)
        return () => {}
      }
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await renderApp()
    const bundle = (glass: ThemeBundle['glass']): ThemeBundle => ({
      id: 'liquid-glass',
      name: 'Liquid Glass',
      colorScheme: 'dark',
      css: '',
      terminal: {},
      wallpaperId: 'lake',
      glass
    })
    act(() => listeners[0]?.(bundle(GLASS_FIXTURE)))
    expect(r.container.querySelector('canvas[aria-hidden="true"]')).not.toBeNull()
    act(() => listeners[0]?.(bundle(null)))
    expect(r.container.querySelector('canvas[aria-hidden="true"]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-glass-on')).toBe(false)
    r.unmount()
  })

  it('unsubscribes from theme:applied on unmount', async () => {
    const unsubscribe = vi.fn()
    ;(window as unknown as { themes: unknown }).themes = {
      list: () => Promise.resolve([]),
      reload: () => Promise.resolve({ ok: true, id: 'default' }),
      openFolder: () => Promise.resolve(),
      onApplied: () => unsubscribe
    }
    const r = await renderApp()
    expect(unsubscribe).not.toHaveBeenCalled()
    r.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('App header — public theme hooks', () => {
  it('marks the brand title for themes', async () => {
    const r = await renderApp()
    expect(q(r, '[data-app-title]').textContent).toBe('Claude Watcher')
  })
})
