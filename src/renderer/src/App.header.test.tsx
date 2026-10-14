// The header layout — App-level. The workspace switcher sits beside the brand, apart from the
// action buttons, so it reads as "where you are" and not as one more control.
// Harness mirrors App.shortcuts.test.tsx (fake window bridges, no Electron).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import type { ThemeBundle } from '../../shared/schemas/theme'
import { GLASS_FIXTURE } from '../../__fixtures__/glassSpec'

/** Resolve a microtask/Promise chain inside act() so async effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined

beforeEach(() => {
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    sessionNamePrompt: null,
    sessionsDialog: null,
    shortcutsDialogOpen: false,
    workspacesDialogOpen: false
  })

  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* no-op shim — jsdom has no layout */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }
  ;(window as unknown as { pty: unknown }).pty = {
    smokeConfig: vi.fn(() => Promise.resolve({ enabled: false, electron: '', abi: '', node: '' }))
  }
  ;(window as unknown as { watch: unknown }).watch = {
    onEvents: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {})
  }
  ;(window as unknown as { attention: unknown }).attention = {
    onActivate: vi.fn(() => () => {}),
    onReminder: vi.fn(() => () => {}),
    reportFocusedTerminal: vi.fn()
  }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() =>
      Promise.resolve({
        version: 1,
        soundEnabled: true,
        terminalFontSize: 14,
        reminderCount: 3,
        reminderFirstDelayMinutes: 2
      })
    ),
    set: vi.fn(() =>
      Promise.resolve({
        version: 1,
        soundEnabled: true,
        terminalFontSize: 14,
        reminderCount: 3,
        reminderFirstDelayMinutes: 2
      })
    )
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve('/home/op/project')),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'launch-term', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-term-tpl', workspaceId: 'default' })
    ),
    rename: vi.fn(() => Promise.resolve()),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
  }
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush()
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

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
    cleanup = undefined // already unmounted above; afterEach must not unmount twice
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('App header — public theme hooks', () => {
  it('marks the brand title for themes', async () => {
    const r = await renderApp()
    expect(q(r, '[data-app-title]').textContent).toBe('Claude Watcher')
  })
})
