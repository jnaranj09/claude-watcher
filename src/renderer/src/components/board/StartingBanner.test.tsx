// Story 5.6 (AC-3) — StartingBanner component tests. jsdom `unit` project.
//
// The StartingBanner is a calm-neutral status-line widget that shows a "N starting · click to open"
// trigger when ≥1 app-launched terminal is not yet represented by a c9watch board card.
//
// Assertions:
//   - Renders NOTHING when there are zero starting terminals.
//   - Shows "1 starting · click to open" when exactly 1 starting terminal exists.
//   - For a single starting terminal: clicking the trigger (banner) calls switchTerminal directly
//     (single-entry optimisation — no popover shown).
//   - For multiple starting terminals: clicking the trigger opens a popover listing each terminal
//     (by `data-testid="starting-entry"`).
//   - Each entry in the popover has: a label (font-mono cwd-basename), a "starting…" status line.
//   - Clicking an entry calls `boardStore.getState().switchTerminal(terminalId)`.
//
// Tests drive the store via `boardStore.setState` / `openLaunchedTerminal` directly (matching the
// existing Board.test.tsx pattern: singleton store + resetStore + `act`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent } from '../../test/renderComponent'
import { StartingBanner } from './StartingBanner'
import { boardStore } from '../../stores/boardStore'
import type { WatchEventsPayload } from '../../../../shared/ipc/contract'

function resetStore(): void {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    coldLoaded: true,
    launchedTerminals: {},
    terminalIdBySessionId: {},
    focusedTerminalId: null,
    viewMode: 'board'
  })
}

let cleanup: (() => void) | undefined

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

/** A quick delta builder for sessionsById (mirrors boardStore.test.ts). */
function updated(epoch: number, id: string): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: `s-${id}`,
      projectPath: `/p/${id}`,
      status: 'Working',
      column: 'working',
      enteredColumnAt: 100,
      pid: 1000,
      workspaceId: 'default',
      tagIds: []
    }
  }
}

describe('StartingBanner — renders nothing when there are no starting terminals', () => {
  it('renders null / empty when registry is empty', () => {
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="starting-banner"]')).toBeNull()
  })

  it('renders null after the only starting terminal is forgotten (exit)', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-1', 'project', 'default')
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="starting-banner"]')).not.toBeNull()

    act(() => {
      boardStore.getState().forgetLaunchedTerminal('t-1')
    })
    expect(container.querySelector('[data-testid="starting-banner"]')).toBeNull()
  })
})

describe('StartingBanner — correct count in trigger text', () => {
  it('shows "1 starting · click to open" for exactly one starting terminal', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-1', 'myproject', 'default')
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount
    const trigger = container.querySelector('[data-testid="starting-banner"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain('1 starting')
    expect(trigger?.textContent).toContain('click to open')
  })

  it('shows "2 starting · click to open" for two starting terminals', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-1', 'project-a', 'default')
      boardStore.getState().showBoard()
      boardStore.getState().openLaunchedTerminal('t-2', 'project-b', 'default')
      boardStore.getState().showBoard()
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount
    const trigger = container.querySelector('[data-testid="starting-banner"]')
    expect(trigger?.textContent).toContain('2 starting')
  })
})

describe('StartingBanner — single-entry optimisation: click opens the terminal directly', () => {
  it('clicking the trigger with ONE starting terminal calls switchTerminal directly (no popover)', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-single', 'singleproject', 'default')
      boardStore.getState().showBoard() // go back to board to test banner click
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="starting-banner"]')
    expect(trigger).not.toBeNull()

    act(() => {
      trigger?.click()
    })

    // switchTerminal was called: the store switched to focused + focusedTerminalId = 't-single'.
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('t-single')

    // No popover opened (single-entry skips the list).
    expect(container.querySelector('[data-testid="starting-popover"]')).toBeNull()
  })
})

describe('StartingBanner — multi-entry popover: click opens a list', () => {
  it('clicking the trigger with TWO starting terminals opens the popover with one entry per terminal', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-1', 'alpha', 'default')
      boardStore.getState().showBoard()
      boardStore.getState().openLaunchedTerminal('t-2', 'beta', 'default')
      boardStore.getState().showBoard()
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="starting-banner"]')
    expect(trigger).not.toBeNull()

    // Before click: no popover.
    expect(container.querySelector('[data-testid="starting-popover"]')).toBeNull()

    act(() => {
      trigger?.click()
    })

    // After click: popover is open with 2 entries.
    const popover = container.querySelector('[data-testid="starting-popover"]')
    expect(popover).not.toBeNull()
    const entries = container.querySelectorAll('[data-testid="starting-entry"]')
    expect(entries).toHaveLength(2)
  })

  it('clicking an entry in the popover calls switchTerminal for that terminal and closes the popover', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-x', 'xproject', 'default')
      boardStore.getState().showBoard()
      boardStore.getState().openLaunchedTerminal('t-y', 'yproject', 'default')
      boardStore.getState().showBoard()
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount

    // Open the popover.
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="starting-banner"]')?.click()
    })
    expect(container.querySelector('[data-testid="starting-popover"]')).not.toBeNull()

    // Click the first entry.
    const firstEntry = container.querySelector<HTMLButtonElement>('[data-testid="starting-entry"]')
    expect(firstEntry).not.toBeNull()
    const entryTerminalLabel = firstEntry?.querySelector('span > span')?.textContent
    act(() => {
      firstEntry?.click()
    })

    // switchTerminal was called: store is now in focused view.
    expect(boardStore.getState().viewMode).toBe('focused')
    // The label displayed must be one of the two labels (font-mono).
    expect(['xproject', 'yproject']).toContain(entryTerminalLabel)

    // Popover closes after selection.
    expect(container.querySelector('[data-testid="starting-popover"]')).toBeNull()
  })

  it('each entry shows the font-mono label and a "starting…" status line (calm-neutral, no gold)', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-a', 'my-app', 'default')
      boardStore.getState().showBoard()
      boardStore.getState().openLaunchedTerminal('t-b', 'other-app', 'default')
      boardStore.getState().showBoard()
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount

    // Open the popover.
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="starting-banner"]')?.click()
    })

    const entries = Array.from(container.querySelectorAll('[data-testid="starting-entry"]'))
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      // Each entry must contain a "starting…" status line.
      expect(entry.textContent).toContain('starting…')
    }
    // The labels should include both app names.
    const allText = entries.map((e) => e.textContent ?? '').join(' ')
    expect(allText).toContain('my-app')
    expect(allText).toContain('other-app')
  })
})

describe('StartingBanner — supersede: leaves strip when card correlates (AC-4)', () => {
  it('disappears when the correlated card arrives in sessionsById', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-1', 'project', 'default')
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount

    // Before correlation: banner is showing.
    expect(container.querySelector('[data-testid="starting-banner"]')).not.toBeNull()

    // Card + correlation land.
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'sess-1'))
      boardStore.getState().addCorrelation('sess-1', 't-1')
    })

    // After correlation + card: banner is gone (superseded — no double card).
    expect(container.querySelector('[data-testid="starting-banner"]')).toBeNull()
  })

  it('draws its list with Popover', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('t-1', 'alpha', 'default')
      boardStore.getState().showBoard()
      boardStore.getState().openLaunchedTerminal('t-2', 'beta', 'default')
      boardStore.getState().showBoard()
    })
    const { container, unmount } = renderComponent(<StartingBanner />)
    cleanup = unmount
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="starting-banner"]')?.click()
    })
    expect(
      container.querySelector('[data-testid="starting-popover"]')?.hasAttribute('data-popover')
    ).toBe(true)
    const entries = container.querySelectorAll('[data-testid="starting-entry"][data-popover-item]')
    expect(entries.length).toBe(2)
  })
})
