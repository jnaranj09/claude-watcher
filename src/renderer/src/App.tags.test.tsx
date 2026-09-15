// Tags — App-level wiring (spec §4.3, §4.4): the header ☰ menu's Tags submenu opens the Tags dialog
// under the single-modal rule (UX-DR14), Escape closes it, and the quit guard closes it. FAKE window
// bridges, the real App — the same harness as App.templates.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import { tagsStore } from './stores/tagsStore'
import type { QuitGuardPayload, Tag, WatchEventsPayload } from '../../shared/ipc/contract'

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }

/** An untagged card in the Default workspace (the one a fresh workspacesStore is active on). */
function untaggedCard(id: string): WatchEventsPayload {
  return {
    epoch: 0,
    event: {
      type: 'session.updated',
      id,
      sessionName: 'card',
      projectPath: '/home/op/project',
      status: 'Working',
      column: 'working',
      enteredColumnAt: 100,
      pid: 4242,
      workspaceId: 'default',
      tagIds: []
    }
  }
}

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
    list: vi.fn(() => Promise.resolve([DEPLOY])),
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
  act(() => tagsStore.setState({ tags: [], loaded: false, activeTagId: null }))
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

/** The header ☰ menu → its Tags submenu → one of the submenu's rows. */
function chooseFromTagsSubmenu(r: RenderResult, row: 'manage-tags' | 'manage-rules'): void {
  click(q(r, '[data-testid="app-menu"]'))
  click(q(r, '[data-testid="app-menu-tags"]'))
  click(q(r, `[data-testid="tags-menu-${row}"]`))
}

function openManageTags(r: RenderResult): void {
  chooseFromTagsSubmenu(r, 'manage-tags')
}

describe('App — tags', () => {
  it('loads the tags on mount; the board filter bar lists them', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(untaggedCard('s1')))
    click(q(r, '[data-testid="filter-toggle"]'))
    click(q(r, '[data-testid="filter-add"]'))
    expect(r.container.querySelector('[data-testid="filter-tag-row-t-deploy"]')).not.toBeNull()
  })

  it('the header filters nothing: the filter bar lives in the board', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(untaggedCard('s1')))
    const header = q(r, '[data-testid="app-header"]')
    expect(header.querySelector('[data-testid="filter-bar"]')).toBeNull()
    expect(q(r, '[data-testid="board-layer"] [data-testid="filter-bar"]')).toBeTruthy()
  })

  it('Manage tags… opens the Tags dialog; Escape closes it', async () => {
    const r = await renderApp()
    openManageTags(r)
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).not.toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).toBeNull()
  })

  // jsdom ignores `inert`, so the click DOES reach the button while the Templates dialog is open —
  // which is exactly what makes this test able to fail: `handleManageTags` itself must refuse.
  // Reverting its `isModalOpen()` guard turns this red.
  it('the single-modal rule: Manage tags… does nothing while another dialog is open', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().openTemplatesDialog())
    openManageTags(r)
    expect(boardStore.getState().tagsDialogOpen).toBe(false)
  })

  it('the quit guard closes the Tags dialog (never two modals stacked)', async () => {
    const r = await renderApp()
    openManageTags(r)
    expect(boardStore.getState().tagsDialogOpen).toBe(true)
    act(() => guardShow?.({ total: 1, workingCount: 0, sessions: [] }))
    expect(boardStore.getState().tagsDialogOpen).toBe(false)
  })

  it('with no tags yet, a card tags button opens the Tags dialog', async () => {
    ;(window as unknown as { tags: { list: () => Promise<Tag[]> } }).tags.list = vi.fn(() =>
      Promise.resolve([])
    )
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(untaggedCard('s1')))
    click(q(r, '[data-session-id="s1"] [data-testid="card-tags-button"]'))
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).not.toBeNull()
  })

  it('Manage rules… opens the Rules dialog under the single-modal rule; Escape closes it', async () => {
    const r = await renderApp()
    chooseFromTagsSubmenu(r, 'manage-rules')
    expect(r.container.querySelector('[data-testid="rules-overlay"]')).not.toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(r.container.querySelector('[data-testid="rules-overlay"]')).toBeNull()
    act(() => boardStore.getState().openTagsDialog())
    chooseFromTagsSubmenu(r, 'manage-rules')
    expect(boardStore.getState().rulesDialogOpen).toBe(false)
  })
})
