// Programmatic API — the renderer side of `launch:requested` (Task 7).
//
// Main's local HTTP API creates the card and then PUSHES `{ terminalId, label, workspaceId }` to
// the renderer, which must react EXACTLY as a UI launch does: call
// `boardStore.getState().openLaunchedTerminal(...)` — the same call `handleNameSubmit` makes after
// its own launch. That call is what actually opens the terminal (the EmbeddedTerminal mounts and
// spawns the pty over `terminal:open`), so without it an API-created card would have no terminal.
//
// The renderer INVENTS NOTHING here: the label and the workspace are main's (session truth), and
// the only thing the renderer adds is the view-state flip into the Focused session.
//
// DO NOT MODIFY App.launch.test.tsx (the frozen B-1 guardrail, AR-12) — this file is a SIBLING
// that mirrors its `window.*` stub block.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import type { LaunchRequestedEvent } from '../../shared/ipc/contract'

/** Resolve a microtask/Promise chain inside act() so async effects settle before asserting. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined
/** Called by the unsubscribe the fake bridge hands back — asserted to run on unmount. */
let offSpy: Mock<() => void>
/** The fake `window.launch.onLaunchRequested`. */
let onLaunchRequestedSpy: ReturnType<typeof vi.fn>
/** The live subscribers, so `deliver` pushes to exactly what is still subscribed (a set, not a
 *  single slot — a StrictMode remount would otherwise leave a stale callback behind). */
const subscribers = new Set<(event: LaunchRequestedEvent) => void>()

beforeEach(() => {
  // Reset the singleton store view-state between cases (App uses the app singleton boardStore).
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    sessionNamePrompt: null
  })

  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both) so the
  // EmbeddedTerminal mounts in the focused view the push drops us into.
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

  subscribers.clear()
  offSpy = vi.fn()
  onLaunchRequestedSpy = vi.fn((cb: (event: LaunchRequestedEvent) => void) => {
    subscribers.add(cb)
    return () => {
      offSpy()
      subscribers.delete(cb)
    }
  })

  // The window bridge surface App + Board + EmbeddedTerminal touch (mirrors App.launch.test.tsx).
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
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'launch-term-xyz', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-term-xyz', workspaceId: 'default' })
    ),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined)),
    onLaunchRequested: onLaunchRequestedSpy
  }
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  // Ensure no leftover hash from a prior test steers the terminal-host view.
  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

/** Mount App and settle smokeConfig → the board view (the non-smoke subscriptions mount here). */
async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush()
  return r
}

/** Main's `launch:requested` push, delivered by hand to whatever App subscribed. */
function deliver(event: LaunchRequestedEvent): void {
  if (subscribers.size === 0) throw new Error('App never subscribed to launch:requested')
  act(() => {
    for (const cb of subscribers) cb(event)
  })
}

describe('programmatic API — launch:requested opens the terminal', () => {
  it('registers the launched terminal with the pushed label and workspace', async () => {
    await renderApp()
    deliver({ terminalId: 'api-t-1', label: 'HT-1', workspaceId: 'default' })

    // The registry entry is main's values verbatim — the renderer invents neither.
    expect(boardStore.getState().launchedTerminals['api-t-1']).toMatchObject({
      terminalId: 'api-t-1',
      label: 'HT-1',
      workspaceId: 'default'
    })
    // ...and the app drops into the Focused session for it, exactly like a UI launch (UX-DR19),
    // which is what mounts the EmbeddedTerminal that spawns the pty.
    expect(boardStore.getState().focusedTerminalId).toBe('api-t-1')
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  it('unsubscribes on unmount', async () => {
    const r = await renderApp()
    expect(onLaunchRequestedSpy).toHaveBeenCalledTimes(1)
    expect(offSpy).not.toHaveBeenCalled()

    r.unmount()
    cleanup = undefined

    // Fault-injection: drop the `return off` from the effect and this goes red.
    expect(offSpy).toHaveBeenCalled()
  })
})
