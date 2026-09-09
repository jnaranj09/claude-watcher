// Story 5.6 — App-level launch registry tests (AC-1, AC-2, AC-5).
//
// These tests verify the NEW Story-5.6 behaviours at the App level:
//   - Launch A records A in launchedTerminals; label = cwd basename.
//   - Launch A then launch B → A stays in selectKeptAliveTerminalIds via the registry
//     even though focusedTerminalId moved to B (closes the silent PTY kill).
//   - window.terminal.onExit for A → forgetLaunchedTerminal(A) → A leaves the registry.
//
// DO NOT MODIFY: App.launch.test.tsx (the frozen B-1 guardrail). This file is a SIBLING.
// It mirrors the beforeEach/seams from App.launch.test.tsx; the frozen file is untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import {
  boardStore,
  selectKeptAliveTerminalIds,
  selectStartingTerminals
} from './stores/boardStore'

/** Resolve a microtask/Promise chain inside act() so async effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined

// These are captured by the setup so tests can drive the fake bridges.
// Use a SET of subscribers (not a single slot) because both App AND EmbeddedTerminal subscribe
// to window.terminal.onExit — using a single variable means the last subscriber wins and
// StrictMode cleanups can null it out. Broadcasting to all active subscribers is correct.
const onExitSubscribers = new Set<(info: { terminalId: string; exitCode: number }) => void>()
function simulateExit(info: { terminalId: string; exitCode: number }): void {
  for (const cb of onExitSubscribers) cb(info)
}
let pickResult: { current: string | null }
let launchCallCount: { n: number }
let launchTerminalIds: string[]

beforeEach(() => {
  onExitSubscribers.clear()
  pickResult = { current: '/home/op/project' }
  launchCallCount = { n: 0 }
  launchTerminalIds = ['launch-A', 'launch-B']

  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {}
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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    observe(): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    unobserve(): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    disconnect(): void {}
  }
  ;(window as unknown as { pty: unknown }).pty = {
    smokeConfig: vi.fn(() => Promise.resolve({ enabled: false, electron: '', abi: '', node: '' }))
  }
  ;(window as unknown as { watch: unknown }).watch = {
    onEvents: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {})
  }
  ;(window as unknown as { attention: unknown }).attention = { onActivate: vi.fn(() => () => {}) }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 })),
    set: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 }))
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    // Use a Set of subscribers so both App and EmbeddedTerminal can subscribe without clobbering
    // each other (both call window.terminal.onExit; a single-slot variable would be overwritten).
    onExit: vi.fn((cb: (info: { terminalId: string; exitCode: number }) => void) => {
      onExitSubscribers.add(cb)
      return () => {
        onExitSubscribers.delete(cb)
      }
    })
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(pickResult.current)),
    launch: vi.fn(() => {
      const id = launchTerminalIds[launchCallCount.n] ?? `launch-${launchCallCount.n}`
      launchCallCount.n++
      return Promise.resolve({ terminalId: id, workspaceId: 'default' })
    }),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-tpl', workspaceId: 'default' })
    ),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
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

// Session templates: `+ New session` is now a popover (folder / templates / Manage), not a
// direct-action button — open it, then click its "Pick a folder…" row.
function clickPickFolder(r: RenderResult): void {
  act(() =>
    (r.container.querySelector('[data-testid="header-new-session"]') as HTMLButtonElement).click()
  )
  act(() =>
    (r.container.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
  )
}

/**
 * Drive a full launch: header button → "Pick a folder…" → picker → the session-naming NAME
 * PROMPT → launch.
 *
 * Session-naming inserted the prompt between the picker and the launch. These Story-5.6 registry
 * tests care about the REGISTRY, not the naming, so the helper ACCEPTS the prefill — which is the
 * cwd basename, exactly the label these tests already assert. Their expectations are unchanged.
 */
async function clickNewSession(r: RenderResult): Promise<void> {
  clickPickFolder(r)
  await flush()
  const confirm = r.container.querySelector<HTMLButtonElement>(
    '[data-testid="session-name-confirm"]'
  )
  if (confirm === null) throw new Error('the session-name prompt was not shown')
  await act(async () => {
    confirm.click()
    await Promise.resolve()
  })
  await flush()
}

describe('App — Story 5.6 launch registry (AC-1)', () => {
  it('launch records entry in launchedTerminals with the correct cwd basename', async () => {
    pickResult.current = '/home/op/myproject'
    const r = await renderApp()
    await clickNewSession(r)
    const entry = Object.values(boardStore.getState().launchedTerminals)[0]
    expect(entry).toBeDefined()
    expect(entry?.terminalId).toBe('launch-A')
    // Label = basename of '/home/op/myproject' = 'myproject'
    expect(entry?.label).toBe('myproject')
  })
})

describe('App — Story 5.6 silent-kill prevention (AC-2)', () => {
  it('launch A then launch B keeps A in selectKeptAliveTerminalIds via the registry (non-vacuous)', async () => {
    // This is the AC-2 regression test: before Story 5.6, launching B would cause A to leave
    // selectKeptAliveTerminalIds (only focusedTerminalId kept it alive), unmounting A's
    // EmbeddedTerminal and killing the PTY. After Story 5.6, A is kept alive via launchedTerminals.
    //
    // FAULT-INJECTION EVIDENCE: removing the launchedTerminals union from selectKeptAliveTerminalIds
    // causes this test to FAIL (A would not be in kept-alive after B takes focus).
    const r = await renderApp()

    // Launch A.
    await clickNewSession(r)
    expect(boardStore.getState().focusedTerminalId).toBe('launch-A')
    expect(selectKeptAliveTerminalIds(boardStore.getState())).toContain('launch-A')

    // Go back to board so we can launch B.
    act(() => {
      boardStore.getState().showBoard()
    })

    // Launch B.
    await clickNewSession(r)
    expect(boardStore.getState().focusedTerminalId).toBe('launch-B')

    // A must still be in kept-alive via the registry (even though focusedTerminalId is now B).
    const alive = selectKeptAliveTerminalIds(boardStore.getState())
    expect(alive).toContain('launch-A') // THE REGRESSION GUARD
    expect(alive).toContain('launch-B')
    // Both are in the launchedTerminals registry.
    expect(boardStore.getState().launchedTerminals['launch-A']).toBeDefined()
    expect(boardStore.getState().launchedTerminals['launch-B']).toBeDefined()
  })
})

describe('App — Story 5.6 onExit clears the registry (AC-5)', () => {
  it('window.terminal.onExit fires → forgetLaunchedTerminal removes the entry', async () => {
    const r = await renderApp()
    await clickNewSession(r)
    expect(boardStore.getState().launchedTerminals['launch-A']).toBeDefined()
    // At least one subscriber (App's forgetLaunchedTerminal handler) must be registered.
    expect(onExitSubscribers.size).toBeGreaterThan(0)

    // Simulate PTY exit for launch-A — broadcasts to ALL subscribers (App + EmbeddedTerminal).
    act(() => {
      simulateExit({ terminalId: 'launch-A', exitCode: 0 })
    })

    // The registry entry must be gone (forgetLaunchedTerminal was called by App's subscriber).
    expect(boardStore.getState().launchedTerminals['launch-A']).toBeUndefined()
  })

  it('onExit for an unknown terminalId is a no-op (idempotent — AC-5)', async () => {
    await renderApp()
    expect(onExitSubscribers.size).toBeGreaterThan(0)
    const before = boardStore.getState().launchedTerminals

    act(() => {
      simulateExit({ terminalId: 'ghost-id', exitCode: 0 })
    })

    // Registry unchanged (no throw, same reference = same content).
    expect(boardStore.getState().launchedTerminals).toBe(before)
  })
})

describe('App — Story 5.6 selectStartingTerminals reflects launched-but-uncorrelated terminals', () => {
  it('after a launch, selectStartingTerminals has the launched terminal (before correlation)', async () => {
    const r = await renderApp()
    await clickNewSession(r)
    // No correlation yet → terminal should be "starting". Workspaces (Task 9a): the launch fixture
    // stamps 'default' (see the window.launch.launch mock above), so query that same workspace.
    const starting = selectStartingTerminals(boardStore.getState(), 'default')
    expect(starting).toHaveLength(1)
    expect(starting[0]?.terminalId).toBe('launch-A')
    expect(starting[0]?.label).toBe('project') // basename of '/home/op/project'
  })
})
