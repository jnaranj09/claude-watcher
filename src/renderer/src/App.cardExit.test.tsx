// Past sessions (D-3/D-5) — App-level ARCHIVE/DELETE card flow tests.
//
// Proves the terminal-binding gate that threads Board → Column → SessionCard
// (Column.tsx's `EmphasizedSessionCard`: `terminalId !== undefined` before Archive/Delete are
// wired onto the card at all) end to end, and that the card's two exit controls fire the SAME
// calls Ctrl+W / the focused bar use (App.tsx's `handleArchiveCard`/`handleDeleteCard`):
//   Archive → window.launch.archiveSession(terminalId), no confirm.
//   Delete  → opens the confirm (boardStore.stopConfirm = { terminalId, sessionId, sessionName }),
//             no bridge call yet (the confirm's own Delete button does that — StopConfirm.test.tsx).
//
// Mirrors App.rename.test.tsx's pattern (full App render, seed a session.updated delta, find the
// card by testid, click, assert on the bridge + the store) — a sibling of App.rename.test.tsx
// and App.launch.test.tsx (the B-1 guardrail).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import type { WatchEventsPayload } from '../../shared/ipc/contract'

/** Resolve a microtask/Promise chain inside act() so async effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** A main→renderer `session.updated` delta, already enriched (column + enteredColumnAt + pid). */
function updated(id: string, sessionName: string): WatchEventsPayload {
  return {
    epoch: 0,
    event: {
      type: 'session.updated',
      id,
      sessionName,
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

let cleanup: (() => void) | undefined
let archiveSpy: ReturnType<typeof vi.fn>
let deleteSpy: ReturnType<typeof vi.fn>

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
    stopConfirm: null
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
  archiveSpy = vi.fn(() => Promise.resolve())
  deleteSpy = vi.fn(() => Promise.resolve())
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'launch-term-xyz', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-term-tpl', workspaceId: 'default' })
    ),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined)),
    // Past sessions (D-3/D-5) — the two exits under test.
    archiveSession: archiveSpy,
    deleteSession: deleteSpy
  }
  // Session templates: loadTemplates() now runs on every App mount — stub it so it never
  // console.warns a code (App.templates.test.tsx amendment #2).
  ;(window as unknown as { templates: unknown }).templates = {
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

describe('App — card Archive/Delete gate on the terminal binding (D-3/D-5, Board → Column → SessionCard)', () => {
  it('renders NEITHER control before correlation, BOTH once terminalIdBySessionId binds the card', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(updated('sess-1', 'deploy-prod')))
    await flush()

    // The card exists (the board shows it) but its terminal binding has not landed yet — a card
    // whose binding is unknown cannot be exited (sessionExit.ts needs a terminalId, not a
    // sessionId), so neither control is rendered.
    expect(r.container.querySelector('[data-testid="session-name"]')?.textContent).toBe(
      'deploy-prod'
    )
    expect(r.container.querySelector('[data-testid="card-archive"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="card-delete"]')).toBeNull()

    // The Tgid-join correlation lands (CH.launchCorrelated in production; addCorrelation is its
    // store-side effect).
    act(() => boardStore.getState().addCorrelation('sess-1', 'term-1'))
    await flush()

    expect(r.container.querySelector('[data-testid="card-archive"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="card-delete"]')).not.toBeNull()
  })

  it('clicking card-archive calls window.launch.archiveSession(terminalId) — NO confirm opens', async () => {
    const r = await renderApp()
    act(() => {
      boardStore.getState().applyWatchEvent(updated('sess-1', 'deploy-prod'))
      boardStore.getState().addCorrelation('sess-1', 'term-1')
    })
    await flush()

    const archiveBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="card-archive"]')
    expect(archiveBtn).not.toBeNull()
    act(() => archiveBtn?.click())
    await flush()

    expect(archiveSpy).toHaveBeenCalledWith('term-1')
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(boardStore.getState().stopConfirm).toBeNull()
    // The card was NOT also activated by the click (SessionCard's stopPropagation) — the board
    // stays on the board, not the focused view.
    expect(boardStore.getState().viewMode).toBe('board')
  })

  it('clicking card-delete opens the confirm with { terminalId, sessionId, sessionName } — calls nothing on the bridge', async () => {
    const r = await renderApp()
    act(() => {
      boardStore.getState().applyWatchEvent(updated('sess-1', 'deploy-prod'))
      boardStore.getState().addCorrelation('sess-1', 'term-1')
    })
    await flush()

    const deleteBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="card-delete"]')
    expect(deleteBtn).not.toBeNull()
    act(() => deleteBtn?.click())
    await flush()

    expect(boardStore.getState().stopConfirm).toEqual({
      terminalId: 'term-1',
      sessionId: 'sess-1',
      sessionName: 'deploy-prod'
    })
    expect(archiveSpy).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
