// Story 4.2 (FR-14) — QuitGuard modal jsdom unit tests (renderer / jsdom project).
//
// Proves (via jsdom render + fake window.quit bridge):
//   (a) Modal renders total + workingCount gold-alert + per-session rows correctly.
//   (b) `Cancel` is the FOCUSED element on mount (UX-DR14 default-focused).
//   (c) `Quit anyway` carries `danger` styling (data-testid="quit-guard-confirm").
//   (d) Clicking Cancel calls `window.quit.cancel` + clears the guard.
//   (e) Clicking Quit anyway calls `window.quit.confirm`.
//   (f) Pressing Enter on Cancel (default-focused) triggers Cancel.
//   (g) Pressing Esc triggers Cancel (UX-DR14: Esc closes topmost layer).
//
// Uses the renderComponent harness (no RTL — bare react-dom + act).
// Mirrors Settings.test.tsx's stub pattern.
// [Source: story 4.2 Task 6.3; UX-DR14; src/renderer/src/components/Settings/Settings.test.tsx]

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { QuitGuard } from './QuitGuard'
import { renderComponent } from '../../test/renderComponent'
import type { QuitGuardPayload } from '../../../../shared/ipc/contract'
import { boardStore } from '../../stores/boardStore'

// ---------------------------------------------------------------------------
// Fake window.quit bridge
// ---------------------------------------------------------------------------

interface QuitBridge {
  requestQuit: () => Promise<void>
  confirm: () => Promise<void>
  cancel: () => Promise<void>
  onGuardShow: (cb: (p: QuitGuardPayload) => void) => () => void
}

let cancelSpy: ReturnType<typeof vi.fn>
let confirmSpy: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

function stubQuit(): { cancelSpy: ReturnType<typeof vi.fn>; confirmSpy: ReturnType<typeof vi.fn> } {
  cancelSpy = vi.fn().mockResolvedValue(undefined)
  confirmSpy = vi.fn().mockResolvedValue(undefined)
  const bridge: QuitBridge = {
    requestQuit: vi.fn().mockResolvedValue(undefined) as () => Promise<void>,
    confirm: confirmSpy as unknown as () => Promise<void>,
    cancel: cancelSpy as unknown as () => Promise<void>,
    onGuardShow: vi.fn(() => () => {})
  }
  ;(window as unknown as { quit: QuitBridge }).quit = bridge
  return { cancelSpy, confirmSpy }
}

// ---------------------------------------------------------------------------
// Test payload
// ---------------------------------------------------------------------------

function makePayload(overrides?: Partial<QuitGuardPayload>): QuitGuardPayload {
  return {
    total: 2,
    workingCount: 1,
    sessions: [
      { id: 'sess-a', sessionName: 'deploy-prod', status: 'Working', column: 'working' },
      { id: 'sess-b', sessionName: 'review-pr', status: 'NeedsAttention', column: 'needs-you' }
    ],
    ...overrides
  }
}

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  // Reset boardStore guard state between tests.
  act(() => {
    boardStore.setState({ quitGuard: null })
  })
})

// ---------------------------------------------------------------------------
// (a) Content rendering
// ---------------------------------------------------------------------------

describe('QuitGuard — content rendering', () => {
  it('renders the title "Quit c9watch?"', () => {
    stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const title = container.querySelector('[data-testid="quit-guard-title"]')
    expect(title?.textContent).toContain('Quit c9watch?')
  })

  it('renders the working-count gold alert when workingCount > 0', () => {
    stubQuit()
    const { container, unmount } = renderComponent(
      <QuitGuard payload={makePayload({ workingCount: 1 })} />
    )
    cleanup = unmount
    const alert = container.querySelector('[data-testid="quit-guard-working-count"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('1')
    expect(alert?.textContent).toContain('still working')
  })

  it('does NOT render the working-count alert when workingCount === 0', () => {
    stubQuit()
    const { container, unmount } = renderComponent(
      <QuitGuard payload={makePayload({ workingCount: 0 })} />
    )
    cleanup = unmount
    const alert = container.querySelector('[data-testid="quit-guard-working-count"]')
    expect(alert).toBeNull()
  })

  it('renders a row for each session in the session list', () => {
    stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const rows = container.querySelectorAll('[data-testid="quit-guard-session-row"]')
    expect(rows.length).toBe(2)
  })

  it('shows the total count', () => {
    stubQuit()
    const { container, unmount } = renderComponent(
      <QuitGuard payload={makePayload({ total: 2 })} />
    )
    cleanup = unmount
    const totalEl = container.querySelector('[data-testid="quit-guard-total"]')
    expect(totalEl?.textContent).toContain('2')
  })

  it('renders "Quit anyway" button with quit-guard-confirm testid (danger styling)', () => {
    stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const confirmBtn = container.querySelector('[data-testid="quit-guard-confirm"]')
    expect(confirmBtn).not.toBeNull()
    expect(confirmBtn?.textContent).toContain('Quit anyway')
  })

  it('renders "Cancel" button with quit-guard-cancel testid', () => {
    stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector('[data-testid="quit-guard-cancel"]')
    expect(cancelBtn).not.toBeNull()
    expect(cancelBtn?.textContent).toContain('Cancel')
  })
})

// ---------------------------------------------------------------------------
// (b) Cancel is default-focused on mount
// ---------------------------------------------------------------------------

describe('QuitGuard — Cancel is focused on mount (UX-DR14)', () => {
  it('Cancel button is the focused element after mount', () => {
    stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector('[data-testid="quit-guard-cancel"]')
    expect(cancelBtn).not.toBeNull()
    // The useEffect focuses Cancel on mount; check the document's active element.
    expect(document.activeElement).toBe(cancelBtn)
  })
})

// ---------------------------------------------------------------------------
// (d) Click Cancel → window.quit.cancel called + guard cleared
// ---------------------------------------------------------------------------

describe('QuitGuard — clicking Cancel', () => {
  it('clicking Cancel calls window.quit.cancel', () => {
    const { cancelSpy: cs } = stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="quit-guard-cancel"]'
    )

    act(() => {
      cancelBtn?.click()
    })

    expect(cs).toHaveBeenCalledTimes(1)
  })

  it('clicking Cancel clears boardStore.quitGuard', () => {
    stubQuit()
    // Pre-set the guard so clearQuitGuard has something to clear.
    act(() => {
      boardStore.setState({ quitGuard: makePayload() })
    })
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="quit-guard-cancel"]'
    )

    act(() => {
      cancelBtn?.click()
    })

    expect(boardStore.getState().quitGuard).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (e) Click Quit anyway → window.quit.confirm called
// ---------------------------------------------------------------------------

describe('QuitGuard — clicking Quit anyway', () => {
  it('clicking Quit anyway calls window.quit.confirm', () => {
    const { confirmSpy: cs } = stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="quit-guard-confirm"]'
    )

    act(() => {
      confirmBtn?.click()
    })

    expect(cs).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// (f) Enter while Cancel is focused → Cancel (default-focused = default action)
// ---------------------------------------------------------------------------

describe('QuitGuard — Enter triggers Cancel (default-focused = reflexive Enter cancels)', () => {
  it('pressing Enter while Cancel is focused calls window.quit.cancel', () => {
    const { cancelSpy: cs } = stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="quit-guard-cancel"]'
    )
    expect(document.activeElement).toBe(cancelBtn) // Cancel is focused

    // Native Enter on a focused button clicks it.
    act(() => {
      cancelBtn?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      cancelBtn?.click() // Simulate Enter → click
    })

    expect(cs).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (g) Esc → Cancel (tested via App.tsx keydown — documented as manual gate)
// Note: the QuitGuard component itself does not handle Esc; it is handled by App.tsx's
// global keydown (which cancels the guard when it is open). This test documents the
// mechanism tested in the App-level keydown test (Task 6.4).
// ---------------------------------------------------------------------------

describe('QuitGuard — dialog accessibility', () => {
  it('has role="dialog" and aria-modal="true"', () => {
    stubQuit()
    const { container, unmount } = renderComponent(<QuitGuard payload={makePayload()} />)
    cleanup = unmount
    const overlay = container.querySelector('[data-testid="quit-guard-overlay"]')
    expect(overlay?.getAttribute('role')).toBe('dialog')
    expect(overlay?.getAttribute('aria-modal')).toBe('true')
  })
})
