// useSessionSeen: the renderer "seen" effect.
//
// While the operator is LOOKING at a session (focused view's pinned active rail session,
// window focused) that is `YourTurn`, useSessionSeen tells main via the typed
// `window.launch.markSeen` invoke. Main demotes ONLY YourTurn → idle (the reducer guard),
// so this can never hide a genuine question/permission [zod-boundaries.md, state.md].
//
// Drives the SINGLETON `boardStore` (the hook binds `useBoard` to it, same as App.tsx —
// see App.keydown.test.tsx for the reset pattern) and stubs `window.launch.markSeen`.
//
// jsdom's `document.hasFocus()` defaults to FALSE (verified locally) — so every test that
// wants the "focused" branch must dispatch a `focus` event first; the "does not fire" tests
// exercise the honest default.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { useSessionSeen } from './useSessionSeen'
import { boardStore, type BoardSession } from '../stores/boardStore'
import { STATUS_YOUR_TURN } from '../../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// Probe component — mounts the hook under test, nothing else.
// ---------------------------------------------------------------------------

function Probe(): React.JSX.Element {
  useSessionSeen()
  return <div />
}

let markSeenSpy: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

function stubLaunch(): void {
  markSeenSpy = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'term-1', workspaceId: 'default' })),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: markSeenSpy
  }
}

function makeSession(id: string, status: string): BoardSession {
  return {
    id,
    sessionName: `s-${id}`,
    projectPath: `/p/${id}`,
    status,
    pid: 1000,
    column: status === STATUS_YOUR_TURN ? 'needs-you' : 'working',
    enteredColumnAt: 1_000,
    workspaceId: 'default',
    tagIds: []
  }
}

/** Seed the singleton store: a focused view, an active (pinned) session bound via
 *  terminalIdBySessionId, and the given status. */
function seedFocused(id: string, status: string): void {
  const terminalId = `term-${id}`
  boardStore.setState({
    viewMode: 'focused',
    focusedTerminalId: terminalId,
    sessionsById: { [id]: makeSession(id, status) },
    terminalIdBySessionId: { [id]: terminalId }
  })
}

async function renderProbe(): Promise<RenderResult> {
  const r = renderComponent(<Probe />)
  cleanup = r.unmount
  await act(async () => {
    await Promise.resolve()
  })
  return r
}

function dispatchWindowFocus(): void {
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
}

function dispatchWindowBlur(): void {
  act(() => {
    window.dispatchEvent(new Event('blur'))
  })
}

beforeEach(() => {
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {}
  })
  stubLaunch()
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// jsdom's document.hasFocus() default — pinning the assumption the whole matrix
// below leans on (see file header).
// ---------------------------------------------------------------------------

describe('jsdom document.hasFocus() default', () => {
  it('is false (so windowFocused starts false and a focus event is required)', () => {
    expect(document.hasFocus()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The 6-case matrix
// ---------------------------------------------------------------------------

describe('useSessionSeen — the deterministic-attention seen effect', () => {
  it('fires markSeen when the active focused session is YourTurn and the window has focus', async () => {
    seedFocused('sess-1', STATUS_YOUR_TURN)
    await renderProbe()
    dispatchWindowFocus()

    expect(markSeenSpy).toHaveBeenCalledTimes(1)
    expect(markSeenSpy).toHaveBeenCalledWith('sess-1')
  })

  it('does NOT fire on the board view', async () => {
    seedFocused('sess-1', STATUS_YOUR_TURN)
    // Overwrite to the board view — same session/status, just not focused-view.
    boardStore.setState({ viewMode: 'board' })
    await renderProbe()
    dispatchWindowFocus()

    expect(markSeenSpy).not.toHaveBeenCalled()
  })

  it('does NOT fire when the window is blurred; fires on the focus event', async () => {
    seedFocused('sess-1', STATUS_YOUR_TURN)
    await renderProbe()

    // Window starts blurred (jsdom default) — no call yet.
    expect(markSeenSpy).not.toHaveBeenCalled()

    dispatchWindowFocus()
    expect(markSeenSpy).toHaveBeenCalledTimes(1)

    dispatchWindowBlur()
    // A blur alone must not fire again.
    expect(markSeenSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire for a NeedsAttention/NeedsPermission/Working/idle active session', async () => {
    for (const status of ['NeedsAttention', 'NeedsPermission', 'Working', 'WaitingForInput']) {
      markSeenSpy.mockClear()
      seedFocused('sess-1', status)
      const r = await renderProbe()
      dispatchWindowFocus()

      expect(markSeenSpy).not.toHaveBeenCalled()
      r.unmount()
      cleanup = undefined
    }
  })

  it('fires again when a NEW Stop lands while the session stays active (status flips back to YourTurn)', async () => {
    seedFocused('sess-1', STATUS_YOUR_TURN)
    await renderProbe()
    dispatchWindowFocus()
    expect(markSeenSpy).toHaveBeenCalledTimes(1)

    // Main demotes YourTurn -> idle once seen is acknowledged (out of scope here — this test
    // simulates that demotion directly), then a NEW Stop hook flips it back to YourTurn while
    // the operator keeps watching the SAME session.
    act(() => {
      boardStore.setState({
        sessionsById: { 'sess-1': makeSession('sess-1', 'idle') }
      })
    })
    expect(markSeenSpy).toHaveBeenCalledTimes(1) // no re-fire while calm

    act(() => {
      boardStore.setState({
        sessionsById: { 'sess-1': makeSession('sess-1', STATUS_YOUR_TURN) }
      })
    })

    expect(markSeenSpy).toHaveBeenCalledTimes(2)
    expect(markSeenSpy).toHaveBeenNthCalledWith(2, 'sess-1')
  })

  it('fires when the rail tab is activated ONTO an already-YourTurn session (activeId change)', async () => {
    // A DIFFERENT terminal is focused first — sess-1 is YourTurn but is NOT the active rail
    // tab, so activeId resolves away from it and markSeen must stay silent. This pins the
    // `activeId` dependency itself: dropping it from the effect's dep array would not turn
    // any OTHER test in this file red (the existing matrix only varies status/viewMode/focus).
    const terminalId = 'term-sess-1'
    boardStore.setState({
      viewMode: 'focused',
      focusedTerminalId: 'term-other',
      sessionsById: { 'sess-1': makeSession('sess-1', STATUS_YOUR_TURN) },
      terminalIdBySessionId: { 'sess-1': terminalId }
    })
    await renderProbe()
    dispatchWindowFocus()

    expect(markSeenSpy).not.toHaveBeenCalled()

    // The operator switches the rail tab onto sess-1 — activeId now resolves to it while
    // status stays YourTurn and the window stays focused.
    act(() => {
      boardStore.setState({ focusedTerminalId: terminalId })
    })

    expect(markSeenSpy).toHaveBeenCalledTimes(1)
    expect(markSeenSpy).toHaveBeenCalledWith('sess-1')
  })

  it('fires when the rail tab is activated onto a YourTurn session with NO prior active terminal', async () => {
    const terminalId = 'term-sess-1'
    boardStore.setState({
      viewMode: 'focused',
      focusedTerminalId: null,
      sessionsById: { 'sess-1': makeSession('sess-1', STATUS_YOUR_TURN) },
      terminalIdBySessionId: { 'sess-1': terminalId }
    })
    await renderProbe()
    dispatchWindowFocus()

    expect(markSeenSpy).not.toHaveBeenCalled()

    act(() => {
      boardStore.setState({ focusedTerminalId: terminalId })
    })

    expect(markSeenSpy).toHaveBeenCalledTimes(1)
    expect(markSeenSpy).toHaveBeenCalledWith('sess-1')
  })

  it('logs a code only (never the id/value) and does not crash when markSeen rejects', async () => {
    markSeenSpy.mockRejectedValueOnce(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    seedFocused('sess-1', STATUS_YOUR_TURN)
    await renderProbe()
    dispatchWindowFocus()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(markSeenSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const loggedArgs = warnSpy.mock.calls[0] ?? []
    const logged = loggedArgs.join(' ')
    expect(logged).toContain('code=')
    expect(logged).not.toContain('sess-1')
  })
})
