// The header ☰ menu — App-level wiring (2026-09-14): it is the ONE header control besides
// `+ New session`, and its Settings… row opens the Settings dialog under the single-modal rule
// (UX-DR14). FAKE window bridges, the real App — the same harness as App.tags.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined
let guardShow: ((payload: QuitGuardPayload) => void) | undefined

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
    templatesDialogOpen: false,
    tagsDialogOpen: false,
    rulesDialogOpen: false,
    settingsDialogOpen: false,
    quitGuard: null
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
    onReminder: vi.fn(() => () => {})
  }
  const settings = {
    version: 1,
    soundEnabled: true,
    terminalFontSize: 14,
    reminderCount: 3,
    reminderFirstDelayMinutes: 2
  }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve(settings)),
    set: vi.fn(() => Promise.resolve(settings))
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    launch: vi.fn(),
    launchFromTemplate: vi.fn(),
    rename: vi.fn(() => Promise.resolve()),
    setTags: vi.fn(() => Promise.resolve()),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
  }
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  ;(window as unknown as { tags: unknown }).tags = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  ;(window as unknown as { rules: unknown }).rules = {
    list: vi.fn(() => Promise.resolve({ rules: [], brokenIds: [] })),
    save: vi.fn(),
    remove: vi.fn(),
    move: vi.fn()
  }
  ;(window as unknown as { quit: unknown }).quit = {
    onGuardShow: vi.fn((cb: (payload: QuitGuardPayload) => void) => {
      guardShow = cb
      return () => {
        guardShow = undefined
      }
    }),
    cancel: vi.fn(() => Promise.resolve()),
    confirm: vi.fn(() => Promise.resolve()),
    requestQuit: vi.fn(() => Promise.resolve())
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

const click = (el: Element): void => act(() => (el as HTMLElement).click())
const overlay = (r: RenderResult): Element | null =>
  r.container.querySelector('[data-testid="settings-overlay"]')

function openSettings(r: RenderResult): void {
  click(q(r, '[data-testid="app-menu"]'))
  click(q(r, '[data-testid="app-menu-settings"]'))
}

describe('App — the header ☰ menu', () => {
  it('is the one header control after + New session: no ⚙, ⌨ or tag icon', async () => {
    const r = await renderApp()
    const header = q(r, '[data-testid="app-header"]')
    for (const gone of ['settings-open', 'open-shortcuts', 'tags-menu']) {
      expect(header.querySelector(`[data-testid="${gone}"]`)).toBeNull()
    }
    const newSession = q(r, '[data-testid="app-header"] [data-testid="header-new-session"]')
    const menu = q(r, '[data-testid="app-header"] [data-testid="app-menu"]')
    expect(newSession.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Settings… opens the Settings dialog; ✕ closes it', async () => {
    const r = await renderApp()
    expect(overlay(r)).toBeNull()
    openSettings(r)
    expect(overlay(r)).not.toBeNull()
    click(q(r, '[data-testid="settings-close"]'))
    expect(overlay(r)).toBeNull()
  })

  it('Escape from the page body closes the Settings dialog', async () => {
    const r = await renderApp()
    openSettings(r)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(overlay(r)).toBeNull()
  })

  it('while Settings is open, the header behind it is inert (it counts as a modal)', async () => {
    const r = await renderApp()
    openSettings(r)
    expect(q(r, '[data-testid="app-header"]').hasAttribute('inert')).toBe(true)
  })

  // jsdom ignores `inert`, so the click DOES reach the menu while another dialog is open — which is
  // what makes this test able to fail: the Settings opener itself must refuse.
  it('the single-modal rule: Settings… does nothing while another dialog is open', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().openTemplatesDialog())
    openSettings(r)
    expect(boardStore.getState().settingsDialogOpen).toBe(false)
  })

  it('the quit guard closes the Settings dialog (never two modals stacked)', async () => {
    const r = await renderApp()
    openSettings(r)
    expect(boardStore.getState().settingsDialogOpen).toBe(true)
    act(() => guardShow?.({ total: 1, workingCount: 0, sessions: [] }))
    expect(boardStore.getState().settingsDialogOpen).toBe(false)
  })
})
