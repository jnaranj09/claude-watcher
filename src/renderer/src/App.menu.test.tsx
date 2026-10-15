// The header ☰ menu — App-level wiring (2026-09-14): it is the ONE header control besides
// `+ New session`, and its Settings… and Past sessions… rows open their dialogs under the
// single-modal rule (UX-DR14). FAKE window bridges, the real App — the same harness as
// App.tags.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import type { RenderResult } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges, unmountApp } from './test/appHarness'
import { boardStore } from './stores/boardStore'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let guardShow: ((payload: QuitGuardPayload) => void) | undefined

beforeEach(() => {
  resetBoardView()
  stubAppBridges({
    themes: {
      list: vi.fn(() => Promise.resolve([])),
      reload: vi.fn(() => Promise.resolve({ ok: true as const, id: 'default' })),
      openFolder: vi.fn(() => Promise.resolve()),
      onApplied: vi.fn(() => () => {})
    },
    tags: {},
    rules: {},
    pastSessions: {
      list: vi.fn(() => Promise.resolve([])),
      forget: vi.fn(() => Promise.resolve([])),
      open: vi.fn()
    },
    quit: {
      onGuardShow: vi.fn((cb: (payload: QuitGuardPayload) => void) => {
        guardShow = cb
        return () => {
          guardShow = undefined
        }
      })
    }
  })
})

afterEach(() => {
  unmountApp()
  vi.restoreAllMocks()
})

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
    act(() => boardStore.getState().openSessionsDialog('templates'))
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

  describe('Sessions ›', () => {
    const panel = (r: RenderResult): Element | null =>
      r.container.querySelector('[data-testid="sessions-panel"]')

    function openPastSessions(r: RenderResult): void {
      click(q(r, '[data-testid="app-menu"]'))
      click(q(r, '[data-testid="app-menu-sessions"]'))
      click(q(r, '[data-testid="sessions-menu-past"]'))
    }

    it('is the last ☰ row; Past sessions… opens the Sessions dialog on Past, which loads the history', async () => {
      const r = await renderApp()
      expect(panel(r)).toBeNull()
      openPastSessions(r)
      await flush()
      expect(panel(r)).not.toBeNull()
      expect(window.pastSessions.list).toHaveBeenCalledTimes(1)
      expect(q(r, '[data-testid="app-header"]').hasAttribute('inert')).toBe(true)
    })

    it('counts as a modal: Ctrl+N and the other openers do nothing while it is open', async () => {
      const r = await renderApp()
      openPastSessions(r)
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })
        )
      })
      await flush()
      expect(window.launch.pickDirectory).not.toHaveBeenCalled()
      expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
      openSettings(r)
      expect(boardStore.getState().settingsDialogOpen).toBe(false)
    })

    it('does nothing while another dialog is open', async () => {
      const r = await renderApp()
      act(() => boardStore.getState().openSessionsDialog('templates'))
      openPastSessions(r)
      expect(boardStore.getState().sessionsDialog).toBe('templates')
    })

    it('Escape from the page body closes it; ✕ closes it too', async () => {
      const r = await renderApp()
      openPastSessions(r)
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(panel(r)).toBeNull()
      openPastSessions(r)
      click(q(r, '[data-testid="sessions-close"]'))
      expect(panel(r)).toBeNull()
    })

    it('the quit guard closes it (never two modals stacked)', async () => {
      const r = await renderApp()
      openPastSessions(r)
      expect(boardStore.getState().sessionsDialog).toBe('past')
      act(() => guardShow?.({ total: 1, workingCount: 0, sessions: [] }))
      expect(boardStore.getState().sessionsDialog).toBeNull()
    })
  })
})
