// Story 3.2 (FR-11) — the App launch-flow wiring tests (AC: #1, #5).
//
// Drives the picker → launch → Focused-session flow through the App component with FAKE window
// bridges (no Electron). Asserts:
//   - `+ New session` opens the native picker (window.launch.pickDirectory) → on a pick, launches
//     (window.launch.launch) in the picked cwd → drops into the Focused-session by terminalId;
//   - CANCEL (picker returns null) is a NO-OP (no launch call, no view change);
//   - Ctrl+N triggers the same flow; Esc returns Focused → Board (UX-DR21);
//   - the EmbeddedTerminal is rendered in the focused view (reused as-is) — keyed by terminalId.
// The byte/PTY path is packaged-smoke-only; here the terminal is the Story-3.1 component with the
// window.terminal fakes (it just wires open()).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
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
let launchResult: { current: { terminalId: string } }
let pickSpy: ReturnType<typeof vi.fn>
let launchSpy: ReturnType<typeof vi.fn>
let terminalStopSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
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
  launchResult = { current: { terminalId: 'launch-term-xyz' } }
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
  ;(window as unknown as { attention: unknown }).attention = { onActivate: vi.fn(() => () => {}) }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 })),
    set: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 }))
  }
  terminalStopSpy = vi.fn(() => Promise.resolve())
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: terminalStopSpy,
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: pickSpy,
    launch: launchSpy,
    // Story 3.4 — App subscribes to the launch-correlation push; the fake returns an unsubscribe.
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
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

describe('App — Story 3.2 launch flow (AC-1, AC-5)', () => {
  it('+ New session → picker → launch in the picked cwd → drops into the Focused-session', async () => {
    const r = await renderApp()
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    expect(button).not.toBeNull()

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
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
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()

    expect(pickSpy).toHaveBeenCalledTimes(1)
    expect(launchSpy).not.toHaveBeenCalled() // no PTY spawned
    expect(boardStore.getState().viewMode).toBe('board') // no view change
    expect(r.container.querySelector('[data-testid="board"]')).not.toBeNull()
    // Session-naming: a cancelled picker must not open the name prompt either.
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).toBeNull()
  })

  it('Ctrl+N triggers the launch flow (UX-DR21)', async () => {
    const r = await renderApp()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
      await Promise.resolve()
    })
    await flush()
    expect(pickSpy).toHaveBeenCalledTimes(1)
    await submitNamePrompt(r)
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  it('Esc returns Focused → Board (UX-DR21)', async () => {
    const r = await renderApp()
    // Enter the focused view via a launch first.
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
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

  it('a launch failure (rejected invoke) does NOT crash — stays on the board', async () => {
    launchSpy.mockImplementation(() => Promise.reject(new Error('spawn failed')))
    const r = await renderApp()
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()
    await submitNamePrompt(r)
    // Picker + launch were attempted; the rejection is swallowed (code-only log) → board stays.
    expect(launchSpy).toHaveBeenCalled()
    expect(boardStore.getState().viewMode).toBe('board')
    // The prompt closes even when the launch rejects — no dead modal is left over the board.
    expect(r.container.querySelector('[data-testid="session-name-overlay"]')).toBeNull()
  })
})

// Session-naming — the create-time name prompt. Covers the I/O-matrix rows that live in the
// renderer: the prompt is prefilled with the cwd basename, a replaced name is what reaches the
// launch AND the Starting-banner label, cancelling spawns nothing, and a blank name cannot submit.
describe('App — session-naming: the create-time name prompt', () => {
  /** Open the prompt via the header button. */
  async function openPrompt(): Promise<RenderResult> {
    const r = await renderApp()
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
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
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
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
