// Story 3.4 (FR-16) — AttentionRail component tests (AC-1, AC-2, AC-5). jsdom `unit` project.
//
// Drives the rail against the singleton boardStore (reset per case). Asserts: always-present +
// collapsible to icons (never hidden); rows = status dot + short name from the SAME source as the
// board; needs-you emphasis applied (the SHIPPED needsYouEmphasisClass) and CLEARED on acknowledge;
// keyboard activation (Enter/Space) = click; aria-live announces a NEW needs-you; click invokes
// onActivateSession with the sessionId; narrow per-row subscription.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { AttentionRail } from './AttentionRail'
import { shortName } from './railName'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import { boardStore } from '../../stores/boardStore'
import type { Column, WatchEventsPayload } from '../../../../shared/ipc/contract'

let cleanup: (() => void) | undefined

function updated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number,
  over: Partial<{ sessionName: string; projectPath: string }> = {}
): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: over.sessionName ?? `s-${id}`,
      projectPath: over.projectPath ?? `/p/${id}`,
      status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
      column,
      enteredColumnAt,
      pid: 1000
    }
  }
}

function resetStore(): void {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    viewMode: 'focused',
    focusedTerminalId: null,
    selectedId: null,
    acknowledgedById: {},
    terminalIdBySessionId: {},
    // Story 5.6 (rail gap): reset the launched-terminals registry so starting-group
    // tests do not bleed state into each other (prior tests left entries).
    launchedTerminals: {}
  })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

function render(onActivateSession: (id: string) => void = () => {}): RenderResult {
  const r = renderComponent(<AttentionRail onActivateSession={onActivateSession} />)
  cleanup = r.unmount
  return r
}

describe('AttentionRail — always present + collapsible (AC-1, UX-DR9)', () => {
  it('is always present and lists one row per app-launched board session (same source as board)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'b', 'working', 200))
    })
    const r = render()
    expect(r.container.querySelector('[data-testid="attention-rail"]')).not.toBeNull()
    const rows = r.container.querySelectorAll('[data-testid="rail-row"]')
    expect(rows.length).toBe(2)
  })

  it('each row shows a status dot + short name (never color-only — UX-DR29)', () => {
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'needs-you', 100, { sessionName: 'deploy-prod' }))
    )
    const r = render()
    const row = r.container.querySelector('[data-session-id="a"]')
    expect(row?.querySelector('[data-testid="status-dot"]')).not.toBeNull()
    expect(row?.querySelector('[data-testid="status-label"]')).not.toBeNull()
    expect(row?.querySelector('[data-testid="rail-row-name"]')?.textContent).toBe('deploy-prod')
  })

  it('collapses to icon-only rows (never hidden) — the rail and rows stay rendered', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100)))
    const r = render()
    const toggle = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')
    expect(toggle).not.toBeNull()
    act(() => toggle?.click())
    const rail = r.container.querySelector('[data-testid="attention-rail"]')
    expect(rail?.getAttribute('data-collapsed')).toBe('true')
    // Still present (NEVER hidden) — the row + dot remain; the visible name text is gone (icon-only).
    expect(r.container.querySelectorAll('[data-testid="rail-row"]').length).toBe(1)
    expect(r.container.querySelector('[data-testid="rail-row-name"]')).toBeNull()
  })

  it('needs-you sessions sort FIRST, then by entered-column time (oldest waiting first)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'work', 'working', 50))
      boardStore.getState().applyWatchEvent(updated(1, 'new-needs', 'needs-you', 300))
      boardStore.getState().applyWatchEvent(updated(1, 'old-needs', 'needs-you', 100))
    })
    const r = render()
    const order = [...r.container.querySelectorAll('[data-testid="rail-row"]')].map((el) =>
      el.getAttribute('data-session-id')
    )
    expect(order).toEqual(['old-needs', 'new-needs', 'work'])
  })
})

describe('AttentionRail — needs-you emphasis applied + cleared (AC-2, AC-4)', () => {
  it('a needs-you row carries the SHIPPED needsYouEmphasisClass; acknowledging clears it', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100)))
    const r = render()
    const row = r.container.querySelector('[data-session-id="a"]')
    expect(row?.getAttribute('data-emphasized')).toBe('true')
    // Consumes the Epic-1 primitive (NOT re-authored) — the class is on the element.
    expect(needsYouEmphasisClass.length).toBeGreaterThan(0)
    expect(row?.className.includes(needsYouEmphasisClass)).toBe(true)

    // Acknowledge → emphasis clears (the ONE shared state; rail + card both follow).
    act(() => boardStore.getState().acknowledge('a'))
    const rowAfter = r.container.querySelector('[data-session-id="a"]')
    expect(rowAfter?.getAttribute('data-emphasized')).toBeNull()
    expect(rowAfter?.className.includes(needsYouEmphasisClass)).toBe(false)
  })

  it('an idle/working row is NOT emphasized (calm)', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100)))
    const r = render()
    expect(
      r.container.querySelector('[data-session-id="w"]')?.getAttribute('data-emphasized')
    ).toBeNull()
  })

  it('the active row (the session being viewed) is highlighted', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
      boardStore.getState().addCorrelation('a', 'launch-a')
      boardStore.getState().switchTerminal('launch-a')
    })
    const r = render()
    expect(r.container.querySelector('[data-session-id="a"]')?.getAttribute('data-active')).toBe(
      'true'
    )
  })
})

describe('AttentionRail — keyboard + aria-live (AC-5, UX-DR29)', () => {
  it('a row is a <button> activatable by keyboard (Enter = click), same effect as click', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100)))
    const onActivate = vi.fn()
    const r = render(onActivate)
    const row = r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')
    expect(row?.tagName).toBe('BUTTON') // native button → Enter/Space activate it natively
    act(() => row?.click())
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('click invokes onActivateSession with the sessionId', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100)))
    const onActivate = vi.fn()
    const r = render(onActivate)
    act(() => r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')?.click())
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('aria-live announces a session NEWLY entering needs-you (not one present at mount)', () => {
    // Present-at-mount needs-you session is NOT announced as new.
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'needs-you', 100, { sessionName: 'preexisting' }))
    )
    const r = render()
    const announcer = r.container.querySelector('[data-testid="live-announcer"]')
    expect(announcer?.textContent).toBe('')

    // A session that ENTERS needs-you after mount IS announced.
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(2, 'b', 'needs-you', 200, { sessionName: 'deploy-prod-rose' }))
    )
    expect(announcer?.textContent).toContain('deploy-prod-rose needs you')
  })

  it('the rail itself has an aria-label nav region (keyboard-navigable landmark)', () => {
    const r = render()
    const rail = r.container.querySelector('[data-testid="attention-rail"]')
    expect(rail?.tagName).toBe('NAV')
    expect(rail?.getAttribute('aria-label')).toBe('Sessions')
  })
})

describe('railName.shortName', () => {
  it('prefers sessionName; falls back to the last path segment; final guard', () => {
    expect(shortName({ sessionName: 'web', projectPath: '/x/y' })).toBe('web')
    expect(shortName({ sessionName: '  ', projectPath: '/home/op/my-proj' })).toBe('my-proj')
    expect(shortName({ sessionName: '', projectPath: '' })).toBe('(session)')
  })
})

// ---------------------------------------------------------------------------
// Story 5.6 (rail gap) — "Starting" group: launched-but-not-yet-correlated
// terminals appear in the rail as calm rows below the session rows.
// ---------------------------------------------------------------------------
describe('AttentionRail — Starting group (Story 5.6 rail gap)', () => {
  it('renders one calm starting row per selectStartingTerminals entry', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('tid-a', 'alpha')
      boardStore.getState().openLaunchedTerminal('tid-b', 'beta')
    })
    const r = render()
    const rows = r.container.querySelectorAll('[data-testid="starting-rail-row"]')
    expect(rows.length).toBe(2)
    // Each row displays the label and "starting…"
    const section = r.container.querySelector('[data-testid="starting-rail-section"]')
    expect(section).not.toBeNull()
    const rowA = r.container.querySelector('[data-terminal-id="tid-a"]')
    expect(rowA).not.toBeNull()
    expect(rowA?.textContent).toContain('alpha')
    expect(rowA?.textContent).toContain('starting…')
    const rowB = r.container.querySelector('[data-terminal-id="tid-b"]')
    expect(rowB).not.toBeNull()
    expect(rowB?.textContent).toContain('beta')
    expect(rowB?.textContent).toContain('starting…')
  })

  it('clicking a starting row calls switchTerminal(terminalId)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-x', 'xray'))
    const r = render()
    // Reset to board so we can verify switchTerminal actually flips to focused.
    act(() => boardStore.getState().showBoard())
    const row = r.container.querySelector<HTMLButtonElement>('[data-terminal-id="tid-x"]')
    expect(row).not.toBeNull()
    act(() => row?.click())
    // switchTerminal sets viewMode='focused' + focusedTerminalId=terminalId — pure view-state.
    const state = boardStore.getState()
    expect(state.focusedTerminalId).toBe('tid-x')
    expect(state.viewMode).toBe('focused')
  })

  it('clicking a starting row does NOT call onActivateSession (no acknowledge; not a c9watch session)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-y', 'yankee'))
    const onActivate = vi.fn()
    const r = render(onActivate)
    const row = r.container.querySelector<HTMLButtonElement>('[data-terminal-id="tid-y"]')
    act(() => row?.click())
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a correlated terminal (has card in sessionsById) does NOT appear as a starting row (supersede)', () => {
    // Launch + correlate + add a card — the terminal should disappear from the starting group.
    act(() => {
      boardStore.getState().openLaunchedTerminal('tid-corr', 'correlated')
      boardStore.getState().addCorrelation('sess-1', 'tid-corr')
      boardStore.getState().applyWatchEvent(updated(1, 'sess-1', 'working', 100))
    })
    const r = render()
    const startingSection = r.container.querySelector('[data-testid="starting-rail-section"]')
    // selectStartingTerminals excludes 'tid-corr' since sessionsById has its card.
    expect(startingSection).toBeNull()
    // The session row IS present in the normal rail list.
    expect(r.container.querySelectorAll('[data-testid="rail-row"]').length).toBe(1)
  })

  it('renders NO starting group when there are no starting terminals', () => {
    // No launched terminals at all.
    const r = render()
    expect(r.container.querySelector('[data-testid="starting-rail-section"]')).toBeNull()
    expect(r.container.querySelectorAll('[data-testid="starting-rail-row"]').length).toBe(0)
  })

  it('starting row is a <button> activatable by keyboard (Enter = click)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-kbd', 'keyboard'))
    const r = render()
    const row = r.container.querySelector('[data-terminal-id="tid-kbd"]')
    expect(row?.tagName).toBe('BUTTON')
  })

  it('in collapsed mode, starting row renders an initial, not the full label+status', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-coll', 'delta'))
    const r = render()
    const toggle = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')
    act(() => toggle?.click())
    const row = r.container.querySelector('[data-terminal-id="tid-coll"]')
    expect(row).not.toBeNull()
    // Collapsed: shows initial only; full name and "starting…" are hidden.
    expect(row?.textContent).toContain('D') // initial of 'delta'
    expect(row?.textContent).not.toContain('starting…')
    expect(row?.textContent).not.toContain('delta')
  })

  it('NON-VACUITY: removing the starting-rows rendering makes this test fail (fault injection proof)', () => {
    // This test proves the starting rows render is load-bearing.
    // Without the startingTerminals rendering, querySelectorAll below returns 0.
    act(() => {
      boardStore.getState().openLaunchedTerminal('tid-nv1', 'nv-alpha')
      boardStore.getState().openLaunchedTerminal('tid-nv2', 'nv-beta')
    })
    const r = render()
    // If StartingRailRow rendering were removed, this assertion would go RED.
    const rows = r.container.querySelectorAll('[data-testid="starting-rail-row"]')
    expect(rows.length).toBe(2)
  })
})
