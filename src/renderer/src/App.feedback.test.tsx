// Action feedback (spec 2026-09-29 §2.3) — App-level results: a folder picker that fails says so;
// ONE native picker at a time from every entry (the header shows it busy); the quit request and
// cancel never leave an unhandled rejection.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import type { RenderResult } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges, unmountApp } from './test/appHarness'
import { boardStore } from './stores/boardStore'
import { toastStore } from './stores/toastStore'

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

const bridges = {
  pickDirectory: vi.fn<() => Promise<string | null>>(),
  requestQuit: vi.fn<() => Promise<void>>(),
  cancel: vi.fn<() => Promise<void>>(),
  confirm: vi.fn<() => Promise<void>>(),
  tagsList: vi.fn<() => Promise<unknown[]>>(),
  rulesList: vi.fn<() => Promise<unknown>>(),
  templatesList: vi.fn<() => Promise<unknown[]>>()
}

beforeEach(() => {
  resetBoardView()
  toastStore.setState({ toasts: [] })
  // Module-level mocks: clear calls AND implementations between tests.
  for (const fn of Object.values(bridges)) fn.mockReset()
  bridges.pickDirectory.mockImplementation(() => Promise.resolve(null))
  bridges.requestQuit.mockImplementation(() => Promise.resolve())
  bridges.cancel.mockImplementation(() => Promise.resolve())
  bridges.confirm.mockImplementation(() => Promise.resolve())
  bridges.tagsList.mockImplementation(() => Promise.resolve([]))
  bridges.rulesList.mockImplementation(() => Promise.resolve({ rules: [], brokenIds: [] }))
  bridges.templatesList.mockImplementation(() => Promise.resolve([]))
  stubAppBridges({
    launch: { pickDirectory: bridges.pickDirectory },
    templates: { list: bridges.templatesList },
    shortcuts: {},
    workspaces: {
      list: vi.fn(() =>
        Promise.resolve({
          activeId: 'default',
          workspaces: [{ id: 'default', name: 'Default', color: 'slate', defaultCwd: null }]
        })
      )
    },
    tags: { list: bridges.tagsList },
    rules: { list: bridges.rulesList },
    quit: { requestQuit: bridges.requestQuit, cancel: bridges.cancel, confirm: bridges.confirm }
  })
})

afterEach(() => {
  unmountApp()
  vi.restoreAllMocks()
})

function clickPickFolder(r: RenderResult): void {
  act(() =>
    r.container.querySelector<HTMLButtonElement>('[data-testid="header-new-session"]')?.click()
  )
  act(() => document.querySelector<HTMLButtonElement>('[data-testid="menu-pick-folder"]')?.click())
}

const toasts = (): string[][] => toastStore.getState().toasts.map((t) => [t.kind, t.title])

describe('App — the folder picker', () => {
  it('a picker that fails says so in a toast (never the thrown message)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridges.pickDirectory.mockImplementation(() => Promise.reject(new Error('dbus /home/op')))
    const r = await renderApp()
    clickPickFolder(r)
    await flush()
    expect(toasts()).toEqual([['error', 'Could not open the folder picker.']])
  })

  it('one native picker at a time: Ctrl+N while it is open opens nothing; the header is busy', async () => {
    let answer: (v: string | null) => void = () => {}
    bridges.pickDirectory.mockImplementation(
      () =>
        new Promise<string | null>((res) => {
          answer = (v) => res(v)
        })
    )
    const r = await renderApp()
    clickPickFolder(r)
    const header = r.container.querySelector('[data-testid="header-new-session"]')
    expect(header?.getAttribute('aria-busy')).toBe('true')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
    })
    expect(bridges.pickDirectory).toHaveBeenCalledTimes(1)
    // The busy header button is disabled, so Ctrl+N must not open its popover either.
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    await act(async () => {
      answer(null)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(header?.hasAttribute('aria-busy')).toBe(false)
  })
})

describe('App — the quit paths never leave a rejection unhandled', () => {
  it('Ctrl+Q: a refused quit request is caught and logged by code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridges.requestQuit.mockImplementation(() => Promise.reject(new Error('x')))
    await renderApp()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true }))
    })
    await flush()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][quit] code=request_quit_failed')
  })

  it('Escape on the quit guard: a refused cancel is caught and logged by code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridges.cancel.mockImplementation(() => Promise.reject(new Error('x')))
    await renderApp()
    act(() => boardStore.setState({ quitGuard: { total: 1, workingCount: 0, sessions: [] } }))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()
    expect(boardStore.getState().quitGuard).toBeNull()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][quit] code=quit_cancel_failed')
  })
})

describe('App — startup loads', () => {
  it('ONE error toast names every store that failed to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridges.tagsList.mockImplementation(() => Promise.reject(new Error('x')))
    bridges.rulesList.mockImplementation(() => Promise.reject(new Error('x')))
    await renderApp()
    await flush()
    expect(toasts()).toEqual([
      ['error', 'Could not load tags and rules. Reopen the app to try again.']
    ])
  })
})
