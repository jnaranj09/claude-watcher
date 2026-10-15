// Story 3.2 (FR-11) — the App launch-flow wiring tests (AC: #1, #5).
//
// Drives the picker → launch → Focused-session flow through the App component with FAKE window
// bridges (no Electron). Asserts:
//   - `+ New session` opens the native picker (window.launch.pickDirectory) → on a pick, launches
//     (window.launch.launch) in the picked cwd → drops into the Focused-session by terminalId;
//   - CANCEL (picker returns null) is a NO-OP (no launch call, no view change);
//   - Ctrl+N triggers the same flow; Esc returns Focused → Board (UX-DR21);
//   - the EmbeddedTerminal is rendered in the focused view (reused as-is) — keyed by terminalId;
//   - Story 5.6 launch registry (AC-1, AC-2, AC-5): a launch enters `launchedTerminals` (label =
//     cwd basename) and stays kept-alive after another launch takes focus; a PTY exit
//     (window.terminal.onExit) removes it;
//   - a workspace switch keeps a hidden workspace's terminal mounted (Task 9a).
// The byte/PTY path is packaged-smoke-only; here the terminal is the Story-3.1 component with the
// window.terminal fakes (it just wires open()).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import {
  boardStore,
  selectKeptAliveTerminalIds,
  selectStartingTerminals
} from './stores/boardStore'
import { workspacesStore } from './stores/workspacesStore'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from '../../shared/schemas/launch'

/** Resolve a microtask/Promise chain inside act() so async effects settle before asserting. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Session-naming — the launch flow is now picker → NAME PROMPT → launch. These Story-3.2 flow
 * tests drive the picker, so they must also submit the prompt to reach the launch.
 * Pass `name` to REPLACE the prefill (the cwd basename); omit it to accept the prefill.
 */
/** Type a name into the open prompt WITHOUT submitting it. */
async function submitNamePromptTypeOnly(r: RenderResult, name: string): Promise<void> {
  const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
  if (input === null) throw new Error('the session-name prompt was not shown')
  // Go through the native value setter so React's onChange fires (a bare `input.value = x`
  // is invisible to React's synthetic event system).
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, name)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function submitNamePrompt(r: RenderResult, name?: string): Promise<void> {
  const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
  if (input === null) throw new Error('the session-name prompt was not shown')
  if (name !== undefined) await submitNamePromptTypeOnly(r, name)
  const confirm = r.container.querySelector<HTMLButtonElement>(
    '[data-testid="session-name-confirm"]'
  )
  await act(async () => {
    confirm?.click()
    await Promise.resolve()
  })
  await flush()
}

let cleanup: (() => void) | undefined
let pickResult: { current: string | null }
let launchResult: { current: { terminalId: string; workspaceId: string } }
let pickSpy: ReturnType<typeof vi.fn>
let launchSpy: ReturnType<typeof vi.fn>
let terminalStopSpy: ReturnType<typeof vi.fn>

// Both App AND EmbeddedTerminal subscribe to window.terminal.onExit, so the fake keeps a SET of
// subscribers (a single slot would let the last subscriber win, and StrictMode cleanups could
// null it out). simulateExit broadcasts to every active subscriber.
const onExitSubscribers = new Set<(info: { terminalId: string; exitCode: number }) => void>()
function simulateExit(info: { terminalId: string; exitCode: number }): void {
  for (const cb of onExitSubscribers) cb(info)
}

beforeEach(() => {
  onExitSubscribers.clear()
  // Reset the singleton store view-state between cases (App uses the app singleton boardStore).
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    // Every case here reuses the SAME fake terminalId ('launch-term-xyz'), and
    // openLaunchedTerminal deliberately KEEPS an existing registry entry (Story 5.6: a re-open
    // must not re-stamp launchedAt or re-sort the Starting list). Without resetting the registry
    // the first case's label would leak into every later one.
    launchedTerminals: {},
    // Session-naming — no create-time prompt open at the start of a case.
    sessionNamePrompt: null
  })
  // Workspaces (Task 9a fix, review round 1, Finding 3) — reset the active workspace so a test
  // that switches it does not bleed into a later test in this file.
  workspacesStore.setState({ activeId: 'default' })

  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both) so the
  // EmbeddedTerminal mounts in the focused view.
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

  pickResult = { current: '/home/op/project' }
  launchResult = { current: { terminalId: 'launch-term-xyz', workspaceId: 'default' } }
  pickSpy = vi.fn(() => Promise.resolve(pickResult.current))
  launchSpy = vi.fn(() => Promise.resolve(launchResult.current))

  // The full window bridge surface App + Board + EmbeddedTerminal touch.
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
  terminalStopSpy = vi.fn(() => Promise.resolve())
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: terminalStopSpy,
    onExit: vi.fn((cb: (info: { terminalId: string; exitCode: number }) => void) => {
      onExitSubscribers.add(cb)
      return () => {
        onExitSubscribers.delete(cb)
      }
    })
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: pickSpy,
    launch: launchSpy,
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-term-xyz', workspaceId: 'default' })
    ),
    // Story 3.4 — App subscribes to the launch-correlation push; the fake returns an unsubscribe.
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
  }
  // Session templates: loadTemplates() now runs on every App mount — stub it so it never
  // console.warns a code (App.templates.test.tsx amendment #2). This suite spies on console.warn.
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

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush() // resolve smokeConfig → board view
  return r
}

// Session templates: `+ New session` is now a popover (folder / templates / Manage), not a
// direct-action button. Every site here that used to click the header button straight into the
// folder flow now opens the popover first, then clicks its "Pick a folder…" row.
function clickPickFolder(r: RenderResult): void {
  act(() =>
    (r.container.querySelector('[data-testid="header-new-session"]') as HTMLButtonElement).click()
  )
  act(() =>
    (document.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
  )
}

/** A full launch: header button → "Pick a folder…" → picker → accept the prefilled name. */
async function launchViaPicker(r: RenderResult): Promise<void> {
  clickPickFolder(r)
  await flush()
  await submitNamePrompt(r)
}

describe('App — Story 3.2 launch flow (AC-1, AC-5)', () => {
  it('+ New session → picker → launch in the picked cwd → drops into the Focused-session', async () => {
    const r = await renderApp()
    clickPickFolder(r)
    await flush()

    // Session-naming: the picker no longer launches directly — it opens the name prompt, and
    // NOTHING is spawned until that prompt is submitted.
    expect(pickSpy).toHaveBeenCalledTimes(1)
    expect(launchSpy).not.toHaveBeenCalled()
    await submitNamePrompt(r)

    // The prefill is the cwd basename, so accepting it reproduces the pre-naming behavior.
    expect(launchSpy).toHaveBeenCalledWith('/home/op/project', 'project')
    // Dropped into the Focused-session showing the launched terminal.
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('launch-term-xyz')
    expect(r.container.querySelector('[data-testid="focused-session"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="embedded-terminal"]')).not.toBeNull()
  })

  it('CANCEL (picker returns null) is a NO-OP — no launch, no view change', async () => {
    pickResult.current = null
    const r = await renderApp()
    clickPickFolder(r)
    await flush()

    expect(pickSpy).toHaveBeenCalledTimes(1)
    expect(launchSpy).not.toHaveBeenCalled() // no PTY spawned
    expect(boardStore.getState().viewMode).toBe('board') // no view change
    expect(r.container.querySelector('[data-testid="board"]')).not.toBeNull()
    // Session-naming: a cancelled picker must not open the name prompt either.
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).toBeNull()
  })

  // Workspaces W-13 [OPERATOR]: `+ New session` and Ctrl+N ALWAYS open the popover — no launch
  // path skips it, so Ctrl+N offers the active workspace's templates like the button does.
  it('Ctrl+N opens the + New session popover, not the folder picker (W-13)', async () => {
    const r = await renderApp()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
      await Promise.resolve()
    })
    await flush()
    expect(document.querySelector('[data-testid="new-session-menu"]')).not.toBeNull()
    expect(pickSpy).not.toHaveBeenCalled()
    // Its folder row is the same launch flow as the button's.
    act(() =>
      (document.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    await flush()
    expect(pickSpy).toHaveBeenCalledTimes(1)
    await submitNamePrompt(r)
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  // Ctrl+Alt is the phrase-shortcut namespace, and this guard had NO altKey term, so a
  // Ctrl+Alt+N chord fired the app as well as the shortcut. Fixed at the SOURCE, not with
  // stopPropagation: an UNMATCHED Ctrl+Alt chord is deliberately not swallowed (it must reach
  // the pty), so it DOES reach this window listener. [design §5 hazard 1]
  it('Ctrl+Alt+N does NOT trigger the launch flow', async () => {
    await renderApp()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, altKey: true }))
      await Promise.resolve()
    })
    await flush()
    expect(pickSpy).not.toHaveBeenCalled()
  })

  it('Esc returns Focused → Board (UX-DR21)', async () => {
    const r = await renderApp()
    // Enter the focused view via a launch first.
    clickPickFolder(r)
    await flush()
    await submitNamePrompt(r)
    expect(boardStore.getState().viewMode).toBe('focused')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('board')
    expect(r.container.querySelector('[data-testid="board"]')).not.toBeNull()
  })

  // The one AR-12 change: the launch-failure contract itself moved, spec 2026-09-29 §2.2.
  it('a launch failure keeps the prompt open with mapped copy — stays on the board', async () => {
    launchSpy.mockImplementation(() => Promise.reject(new Error('spawn failed')))
    const r = await renderApp()
    clickPickFolder(r)
    await flush()
    await submitNamePrompt(r)
    expect(launchSpy).toHaveBeenCalled()
    expect(boardStore.getState().viewMode).toBe('board')
    // Spec 2026-09-29 §2.2: the prompt stays, with the typed name, and says why — never the
    // thrown message.
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).not.toBeNull()
    const line = r.container.querySelector('[data-testid="session-name-error"]')
    expect(line?.textContent).toBe('Could not start the session.')
    expect(r.container.textContent).not.toContain('spawn failed')
  })
})

// Session-naming — the create-time name prompt. Covers the I/O-matrix rows that live in the
// renderer: the prompt is prefilled with the cwd basename, a replaced name is what reaches the
// launch AND the Starting-banner label, cancelling spawns nothing, and a blank name cannot submit.
describe('App — session-naming: the create-time name prompt', () => {
  /** Open the prompt via the header button's "Pick a folder…" row. */
  async function openPrompt(): Promise<RenderResult> {
    const r = await renderApp()
    clickPickFolder(r)
    await flush()
    return r
  }

  it('prefills the input with the cwd basename', async () => {
    const r = await openPrompt()
    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    expect(input).not.toBeNull()
    expect(input?.value).toBe('project') // basename of '/home/op/project'
  })

  it('the operator-typed name reaches the launch AND becomes the launched-terminal label', async () => {
    const r = await openPrompt()
    await submitNamePrompt(r, 'billing api')

    expect(launchSpy).toHaveBeenCalledWith('/home/op/project', 'billing api')
    // Story 5.6 label: the Starting banner shows the operator's name, not the basename — so the
    // banner and the card that replaces it agree from the first frame.
    expect(boardStore.getState().launchedTerminals['launch-term-xyz']?.label).toBe('billing api')
  })

  it('TRIMS the submitted name (matching what main stores)', async () => {
    const r = await openPrompt()
    await submitNamePrompt(r, '  billing api  ')
    expect(launchSpy).toHaveBeenCalledWith('/home/op/project', 'billing api')
  })

  it('CANCEL spawns nothing — no launch, no card, no view change', async () => {
    const r = await openPrompt()
    const cancel = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="session-name-cancel"]'
    )
    await act(async () => {
      cancel?.click()
      await Promise.resolve()
    })
    await flush()

    expect(launchSpy).not.toHaveBeenCalled()
    expect(boardStore.getState().viewMode).toBe('board')
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).toBeNull()
  })

  it('Esc cancels the prompt and does NOT fall through to showBoard (topmost layer wins)', async () => {
    const r = await openPrompt()
    // Put the app in the FOCUSED view first: `showBoard()` is a no-op on the board, so on the
    // board this test could not tell "Esc was consumed by the prompt" from "Esc fell through".
    // From the focused view a fall-through is VISIBLE as viewMode flipping to 'board'.
    boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'launch-term-xyz' })

    // Dispatch from the FOCUSED INPUT, not from window, so the event takes the real path
    // (keydown on the input → bubbles to the window listener).
    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(boardStore.getState().sessionNamePrompt).toBeNull()
    expect(launchSpy).not.toHaveBeenCalled()
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).toBeNull()
    // THE LOAD-BEARING ASSERTION: the Esc branch must `return` after clearing the prompt.
    // Delete that `return` and execution falls through to showBoard() → this flips to 'board'.
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  it('Ctrl+N while the prompt is open is IGNORED — it cannot swap the cwd under a typed name', async () => {
    const r = await openPrompt()
    expect(pickSpy).toHaveBeenCalledTimes(1)
    // The operator has typed a name for the FIRST directory.
    await submitNamePromptTypeOnly(r, 'billing api')

    // A second Ctrl+N must NOT re-open the picker: the payload swap would leave this dialog
    // showing 'billing api' while onSubmit closed over a DIFFERENT cwd.
    pickResult.current = '/home/op/other'
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
      await Promise.resolve()
    })
    await flush()

    expect(pickSpy).toHaveBeenCalledTimes(1) // still 1 — the re-entry was refused
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    // The prompt payload is a create/rename union — narrow before reading the create-only `cwd`.
    const prompt = boardStore.getState().sessionNamePrompt
    expect(prompt?.mode).toBe('create')
    expect(prompt !== null && prompt.mode === 'create' ? prompt.cwd : null).toBe('/home/op/project')

    // Submitting still launches the ORIGINAL directory under the typed name.
    const confirm = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="session-name-confirm"]'
    )
    await act(async () => {
      confirm?.click()
      await Promise.resolve()
    })
    await flush()
    expect(launchSpy).toHaveBeenCalledWith('/home/op/project', 'billing api')
  })

  it('an OVER-LONG directory basename is clamped, so the prompt opens submittable', async () => {
    // A real directory whose basename exceeds the cap. Before the clamp, the dialog opened with
    // the full basename, Create was enabled, and submitting closed the modal and then failed
    // silently in main — no session, no card, no message.
    const longName = 'a'.repeat(SESSION_NAME_MAX_LENGTH + 25)
    pickResult.current = `/home/op/${longName}`
    const r = await openPrompt()

    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    expect(input?.value.length).toBe(SESSION_NAME_MAX_LENGTH)

    const confirm = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="session-name-confirm"]'
    )
    expect(confirm?.disabled).toBe(false)

    await act(async () => {
      confirm?.click()
      await Promise.resolve()
    })
    await flush()
    // It launches, and the name it sends is within the bound main will accept.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    const sentName = launchSpy.mock.calls[0]?.[1] as string
    expect(sentName.length).toBeLessThanOrEqual(SESSION_NAME_MAX_LENGTH)
    expect(SessionNameSchema.safeParse(sentName).success).toBe(true)
  })

  it('the launch-failure log carries a code= and NEVER the name or the cwd (AC-5)', async () => {
    launchSpy.mockImplementation(() => Promise.reject(new Error('spawn failed')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await openPrompt()
    await submitNamePrompt(r, 'billing api')

    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('code=')
    // never-log-the-value (zod-boundaries.md): neither the operator's name nor the picked path.
    expect(logged).not.toContain('billing api')
    expect(logged).not.toContain('/home/op/project')
  })

  it('a BLANK name cannot submit — the button is disabled and no launch fires', async () => {
    const r = await openPrompt()
    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, '   ') // whitespace-only → trims to empty
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const confirm = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="session-name-confirm"]'
    )
    expect(confirm?.disabled).toBe(true)

    await act(async () => {
      confirm?.click()
      await Promise.resolve()
    })
    await flush()
    expect(launchSpy).not.toHaveBeenCalled()
    // The prompt stays open so the operator can correct it.
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).not.toBeNull()
  })
})

// Story 3.4 (B-1 regression) — the Board↔Focused view switch is KEPT-ALIVE: it must NEVER unmount
// the EmbeddedTerminal, because unmounting runs the terminal's cleanup effect (term.dispose() +
// window.terminal.stop(terminalId)) which KILLS the live PTY in main. The old JSX ternary
// (`{showFocused ? <FocusedSession/> : <Board/>}`) unmounted FocusedSession on Esc → killed the
// session. This test drives a real focused → board → focused toggle through the App-level switch
// site and asserts the PTY is NOT stopped (window.terminal.stop is never called) on the transition.
//
// NON-VACUOUS: against the pre-fix ternary, pressing Esc unmounts FocusedSession → its
// EmbeddedTerminal cleanup calls window.terminal.stop(terminalId) → this expectation FAILS. With the
// stacked visibility:hidden fix the terminal stays mounted → stop is never called → it PASSES.
describe('App — Story 3.4 B-1: Board↔Focused switch is kept-alive (PTY survives, AC-3 / terminal.md)', () => {
  it('focused → board → focused does NOT stop/dispose the terminal (the live PTY is not killed)', async () => {
    const r = await renderApp()

    // 1) Launch → drop into the focused view (the EmbeddedTerminal mounts + opens its PTY).
    clickPickFolder(r)
    await flush()
    await submitNamePrompt(r)
    expect(boardStore.getState().viewMode).toBe('focused')
    const termEl = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(termEl).not.toBeNull()
    expect(termEl?.getAttribute('data-terminal-id')).toBe('launch-term-xyz')

    // Baseline: opening the terminal must not have stopped anything.
    expect(terminalStopSpy).not.toHaveBeenCalled()

    // 2) Esc → Board. With the OLD ternary this UNMOUNTS FocusedSession → the EmbeddedTerminal
    //    cleanup runs → window.terminal.stop(terminalId) is called → the PTY dies. The fix keeps it
    //    mounted (visibility:hidden), so stop must NOT be called.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('board')

    // 3) Re-enter the focused view (switch back to the SAME terminal — a pure view-state flip).
    await act(async () => {
      boardStore.getState().switchTerminal('launch-term-xyz')
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('focused')

    // The terminal element is the SAME mounted instance throughout (still present, same id).
    const termAfter = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(termAfter).not.toBeNull()
    expect(termAfter?.getAttribute('data-terminal-id')).toBe('launch-term-xyz')

    // THE ASSERTION: the PTY was NEVER stopped across focused → board → focused. A view switch is
    // not a session stop — the kept-alive terminal must survive (terminal.md / AC-3).
    expect(terminalStopSpy).not.toHaveBeenCalled()
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
    launchResult.current = { terminalId: 'launch-A', workspaceId: 'default' }
    await launchViaPicker(r)
    expect(boardStore.getState().focusedTerminalId).toBe('launch-A')
    expect(selectKeptAliveTerminalIds(boardStore.getState())).toContain('launch-A')

    // Go back to board so we can launch B.
    act(() => {
      boardStore.getState().showBoard()
    })

    // Launch B.
    launchResult.current = { terminalId: 'launch-B', workspaceId: 'default' }
    await launchViaPicker(r)
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
    await launchViaPicker(r)
    expect(boardStore.getState().launchedTerminals['launch-term-xyz']).toBeDefined()
    // At least one subscriber (App's forgetLaunchedTerminal handler) must be registered.
    expect(onExitSubscribers.size).toBeGreaterThan(0)

    // Simulate PTY exit for the launch — broadcasts to ALL subscribers (App + EmbeddedTerminal).
    act(() => {
      simulateExit({ terminalId: 'launch-term-xyz', exitCode: 0 })
    })

    // The registry entry must be gone (forgetLaunchedTerminal was called by App's subscriber).
    expect(boardStore.getState().launchedTerminals['launch-term-xyz']).toBeUndefined()
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
    await launchViaPicker(r)
    // No correlation yet → terminal should be "starting". Workspaces (Task 9a): the launch fixture
    // stamps 'default' (see launchResult above), so query that same workspace.
    const starting = selectStartingTerminals(boardStore.getState(), 'default')
    expect(starting).toHaveLength(1)
    expect(starting[0]?.terminalId).toBe('launch-term-xyz')
    expect(starting[0]?.label).toBe('project') // basename of '/home/op/project'
  })
})

// Task 9a fix (review round 1, Finding 3 — highest risk) — a workspace switch must be a PURE
// show/hide. `selectKeptAliveTerminalIds` proves the SELECTOR body is unfiltered (boardStore.test.ts),
// but that cannot catch the catastrophic version of the mistake: someone wrapping the
// `keptAlive.map(...)` in FocusedSession.tsx (or the `App.tsx` mount-gate that keeps FocusedSession
// alive) in a workspace filter to "clean up hidden terminals". That would UNMOUNT the
// EmbeddedTerminal, which runs its cleanup (term.dispose() + window.terminal.stop(terminalId)) and
// KILLS the live PTY — losing the operator's session. This mirrors the B-1 regression guard above,
// just for a WORKSPACE switch instead of a Board↔Focused toggle.
describe("App — Task 9a fix: a workspace switch keeps a HIDDEN workspace's terminal mounted (PTY survives)", () => {
  it('a terminal launched in workspace w1 stays in the DOM (and its PTY is never stopped) after switching the active workspace to w2', async () => {
    const r = await renderApp()

    // Launch directly via the store action (the same production action App wires to the picker
    // flow) — simpler than driving the picker UI, and exercises the real App→FocusedSession→
    // EmbeddedTerminal mount pipeline reactively.
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-w1', 'projA', 'w1')
    })
    await flush()
    expect(r.container.querySelector('[data-terminal-id="t-w1"]')).not.toBeNull()

    expect(terminalStopSpy).not.toHaveBeenCalled() // baseline: launching must not have stopped anything

    // Switch the ACTIVE workspace to w2, which has no terminal of its own — `focusWorkspace` falls
    // back to the board view (mirrors how Task 9b's switcher will wire setActiveWorkspace +
    // focusWorkspace; see boardStore.test.ts's "workspace filtering" describe block).
    act(() => {
      workspacesStore.setState({ activeId: 'w2' })
      boardStore.getState().focusWorkspace('w2')
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('board') // w2 has nothing to focus → falls back

    // THE ASSERTION: w1's terminal is STILL in the DOM (hidden is fine and expected —
    // visibility:hidden on the whole frame per terminal.md — but PRESENT, not unmounted) and its
    // PTY was NEVER stopped. Non-vacuous: a workspace filter wrapped around `keptAlive.map(...)`
    // would unmount it, both these assertions would flip, and this test would fail exactly here.
    const termAfter = r.container.querySelector('[data-terminal-id="t-w1"]')
    expect(termAfter).not.toBeNull()
    expect(terminalStopSpy).not.toHaveBeenCalled()
  })
})
