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
    terminalIdBySessionId: {}
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
