// Story 1.4 — Board / Column render tests (AC-1..AC-6, AC-9). jsdom `unit` project.
//
// Renders the live <Board/> against the singleton boardStore (reset per test) and a
// stubbed `window.watch`/`window.pty`. Asserts: cold-load skeleton renders before the
// first delta then clears (via a delta OR the engine-started watch:status push);
// empty-column hints (incl. the calm needs-you hint); empty board headline +
// `+ New session`; every session → exactly one card (no dup); native fields verbatim;
// aria-live region present. Uses the existing renderComponent helper (NO RTL).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { Board } from './Board'
import { boardStore, HERO_SWAP_DEBOUNCE_MS } from '../../stores/boardStore'
import { renderComponent } from '../../test/renderComponent'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  Column,
  WatchEventsPayload,
  AttentionActivatePayload
} from '../../../../shared/ipc/contract'

/** The shape the Board needs off `window.watch` (mirrors the preload WatchApi). */
interface WatchBridge {
  onEvents(cb: (payload: WatchEventsPayload) => void): () => void
  onStatus(cb: (status: { reconnecting: boolean }) => void): () => void
}

/** The shape the Board needs off `window.attention` (mirrors the preload AttentionApi). */
interface AttentionBridge {
  onActivate(cb: (payload: AttentionActivatePayload) => void): () => void
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

/** Reset the singleton store to a pristine pre-cold-load state (incl. the Story-1.5
 *  hero-debounce bookkeeping: committed hero back to the default 'working', no pending). */
function resetStore(): void {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    coldLoaded: false,
    heroColumn: 'working',
    heroPendingSince: null,
    heroPendingTarget: null,
    selectedId: null
  })
}

/** Apply a delta INSIDE act() so the subscribed Board re-renders before we assert. */
function applyDelta(payload: WatchEventsPayload): void {
  act(() => {
    boardStore.getState().applyWatchEvent(payload)
  })
}

/** Stub window.watch + window.attention with no-op subscriptions so the Board's mount effects
 *  are inert (the tests drive the store directly). Returns captures of the registered onStatus
 *  and onActivate callbacks so a test can push a signal through the real seam. */
function stubBridges(): {
  pushStatus: (reconnecting: boolean) => void
  pushActivate: (id: string) => void
} {
  let statusCb: ((status: { reconnecting: boolean }) => void) | undefined
  let activateCb: ((payload: AttentionActivatePayload) => void) | undefined
  const watch: WatchBridge = {
    onEvents: () => () => {},
    onStatus: (cb) => {
      statusCb = cb
      return () => {
        statusCb = undefined
      }
    }
  }
  const attention: AttentionBridge = {
    onActivate: (cb) => {
      activateCb = cb
      return () => {
        activateCb = undefined
      }
    }
  }
  ;(window as unknown as { watch: WatchBridge }).watch = watch
  ;(window as unknown as { attention: AttentionBridge }).attention = attention
  return {
    pushStatus: (reconnecting) => statusCb?.({ reconnecting }),
    pushActivate: (id) => activateCb?.({ id })
  }
}

function updated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number,
  over: Partial<{
    sessionName: string
    projectPath: string
    status: string
    pid: number
    pendingToolName: string
  }> = {}
): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: over.sessionName ?? `s-${id}`,
      projectPath: over.projectPath ?? `/p/${id}`,
      status: over.status ?? 'Working',
      column,
      enteredColumnAt,
      pid: over.pid ?? 1000,
      ...(over.pendingToolName !== undefined ? { pendingToolName: over.pendingToolName } : {})
    }
  }
}

/** Commit a hero swap deterministically: the singleton store uses the real clock, so
 *  backdate the pending anchor past the debounce window and tick. After this the
 *  committed hero == target. */
function commitHero(): void {
  act(() => {
    const since = boardStore.getState().heroPendingSince
    if (since !== null) {
      boardStore.setState({ heroPendingSince: since - (HERO_SWAP_DEBOUNCE_MS + 1) })
    }
    boardStore.getState().tickHero()
  })
}

beforeEach(() => {
  resetStore()
  stubBridges()
})

describe('Board — cold-load skeleton (AC-5)', () => {
  it('renders the skeleton (ghost cards, no spinner) before the first delta', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="skeleton-board"]')).not.toBeNull()
    expect(
      container.querySelectorAll('[data-testid="skeleton-card"]').length
    ).toBeGreaterThanOrEqual(3)
    // No spinner, and NOT the empty board.
    expect(container.querySelector('[data-testid="empty-board"]')).toBeNull()
    expect(container.querySelector('[data-testid="column-grid"]')).toBeNull()
  })

  it('clears the skeleton to live content once the first delta arrives', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="skeleton-board"]')).not.toBeNull()
    // First delta (epoch ≥ 1) flips coldLoaded → the grid replaces the skeleton.
    applyDelta(updated(1, 'a', 'working', 100))
    expect(container.querySelector('[data-testid="skeleton-board"]')).toBeNull()
    expect(container.querySelector('[data-testid="column-grid"]')).not.toBeNull()
  })
})

describe('Board — cold-load-complete via watch:status (Story 5.3/6.4 — the engine-started push clears the skeleton)', () => {
  it('pushing a status(false) on a fresh zero-session board clears the skeleton and shows the empty board', () => {
    // The renderer-side proof of the engine-started signal: the Story-6.4 native engine's
    // startup `CH.watchStatus { reconnecting: false }` (index.ts registerWatchFeed) reaches
    // the Board's onStatus subscription, calls setReconnecting, and flips coldLoaded:true —
    // even when ZERO deltas ever ship (the normal empty cold start). This is the ONLY
    // skeleton-clear path on a fresh, no-launch start; break the signal and this turns red.
    const { pushStatus } = stubBridges()
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    // Before the status push: skeleton is showing (cold-load not done).
    expect(container.querySelector('[data-testid="skeleton-board"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-board"]')).toBeNull()
    // Push the startup status (mirrors feed.ts emitStatus(false) after list seed).
    act(() => {
      pushStatus(false)
    })
    // After the status push: skeleton is gone, empty-board is showing.
    expect(container.querySelector('[data-testid="skeleton-board"]')).toBeNull()
    expect(container.querySelector('[data-testid="empty-board"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-board"]')?.textContent).toContain(
      'No sessions yet.'
    )
  })
})

describe('Board — empty states never collapse (AC-4)', () => {
  it('empty board (cold-loaded, zero sessions) shows the headline + the single + New session', () => {
    // Cold-load with NO sessions: a removed delta on an empty store flips coldLoaded.
    boardStore.setState({ coldLoaded: true })
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    const empty = container.querySelector('[data-testid="empty-board"]')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toContain('No sessions yet.')
    const btn = container.querySelector('[data-testid="new-session"]')
    expect(btn?.textContent).toContain('+ New session')
  })

  it('+ New session is a SEAM — clicking fires the injected onNewSession (no launch built)', () => {
    boardStore.setState({ coldLoaded: true })
    const onNewSession = vi.fn()
    const { container, unmount } = renderComponent(<Board onNewSession={onNewSession} />)
    cleanup = unmount
    container.querySelector<HTMLButtonElement>('[data-testid="new-session"]')?.click()
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('empty needs-you column renders the CALM hint "Nothing waiting. All quiet."', () => {
    // One working session → board is live; needs-you + idle are empty (keep headers + hints).
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    const needsYou = container.querySelector('[data-column="needs-you"]')
    expect(needsYou).not.toBeNull()
    expect(needsYou?.querySelector('[data-testid="empty-hint"]')?.textContent).toBe(
      'Nothing waiting. All quiet.'
    )
    // The empty column still shows its header (count 0) — never collapsed.
    expect(needsYou?.querySelector('[data-testid="column-count"]')?.textContent).toContain('0')
  })

  it('empty idle column hint is "Nothing waiting." (no Done column; FROZEN-1)', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    const idle = container.querySelector('[data-column="idle"]')
    expect(idle?.querySelector('[data-testid="empty-hint"]')?.textContent).toBe('Nothing waiting.')
  })
})

describe('Board — live three columns, one card per session, verbatim fields (AC-1)', () => {
  it('renders every session as exactly one card, none duplicated, native fields verbatim', () => {
    const st = boardStore.getState()
    st.applyWatchEvent(
      updated(1, 'w', 'working', 100, { sessionName: 'web', projectPath: '/repo/web', pid: 4242 })
    )
    st.applyWatchEvent(
      updated(1, 'n', 'needs-you', 200, {
        status: 'NeedsAttention',
        pendingToolName: 'Bash',
        pid: 7
      })
    )
    st.applyWatchEvent(updated(1, 'i', 'idle', 300, { status: 'WaitingForInput', pid: 9 }))

    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    // Exactly three cards across the three columns, none missing/duplicated.
    const names = Array.from(container.querySelectorAll('[data-testid="session-name"]')).map(
      (e) => e.textContent
    )
    expect(names.sort()).toEqual(['s-i', 'web', 's-n'].sort())

    // Verbatim native fields on the working card.
    const workingCol = container.querySelector('[data-column="working"]')
    expect(workingCol?.querySelector('[data-testid="project-path"]')?.textContent).toBe('/repo/web')
    expect(workingCol?.querySelector('[data-testid="pid"]')?.textContent).toBe('4242')

    // pendingToolName shows on the needs-you card (verbatim, when present).
    const needsYouCol = container.querySelector('[data-column="needs-you"]')
    expect(needsYouCol?.querySelector('[data-testid="pending-tool"]')?.textContent).toBe('Bash')
  })

  it('an aria-live region is present at board level (AC-9)', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    const live = container.querySelector('[data-testid="live-announcer"]')
    expect(live).not.toBeNull()
    expect(live?.getAttribute('aria-live')).toBe('polite')
  })
})

describe('Board — adaptive center-hero cascade (Story 1.5: AC-1, AC-2, AC-3)', () => {
  it('default (only Working) → Working is the hero (prominent header + variant=hero cards + data-hero-accent=working)', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    const grid = container.querySelector('[data-testid="column-grid"]')
    expect(grid?.getAttribute('data-hero-column')).toBe('working')

    const heroCol = container.querySelector('[data-column="working"]')
    expect(heroCol?.getAttribute('data-hero')).toBe('true')
    expect(heroCol?.getAttribute('data-hero-accent')).toBe('working')
    // Hero header is prominent; hero card variant is 'hero' with the working accent.
    expect(heroCol?.querySelector('[data-prominent="true"]')).not.toBeNull()
    const heroCard = heroCol?.querySelector('[data-variant="hero"]')
    expect(heroCard).not.toBeNull()
    expect(heroCard?.getAttribute('data-accent')).toBe('working')

    // Idle is a flank (right slot), never the hero.
    const idleCol = container.querySelector('[data-column="idle"]')
    expect(idleCol?.getAttribute('data-hero')).toBeNull()
  })

  it('a committed Needs-you (≥1 past the debounce) → Needs-you is the hero (gold accent), Working recedes to a flank', () => {
    const st = boardStore.getState()
    st.applyWatchEvent(updated(1, 'w', 'working', 100))
    st.applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    // The swap is debounced — commit it deterministically.
    commitHero()

    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    const grid = container.querySelector('[data-testid="column-grid"]')
    expect(grid?.getAttribute('data-hero-column')).toBe('needs-you')

    const heroCol = container.querySelector('[data-column="needs-you"]')
    expect(heroCol?.getAttribute('data-hero')).toBe('true')
    expect(heroCol?.getAttribute('data-hero-accent')).toBe('needs-you')
    expect(heroCol?.querySelector('[data-prominent="true"]')).not.toBeNull()
    const heroCard = heroCol?.querySelector('[data-variant="hero"]')
    expect(heroCard?.getAttribute('data-accent')).toBe('needs-you')

    // Working has receded to a flank (calm variant, non-prominent header).
    const workingCol = container.querySelector('[data-column="working"]')
    expect(workingCol?.getAttribute('data-hero')).toBeNull()
    expect(workingCol?.querySelector('[data-variant="calm"]')).not.toBeNull()
    expect(workingCol?.querySelector('[data-prominent="false"]')).not.toBeNull()
  })

  it('IDLE IS NEVER THE HERO — even when idle is the ONLY non-empty column (AC-2)', () => {
    // Degenerate case: only idle sessions exist. The hero must NOT promote idle; Working
    // takes the (empty/calm) center; idle stays the right flank.
    boardStore
      .getState()
      .applyWatchEvent(updated(1, 'i', 'idle', 300, { status: 'WaitingForInput' }))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    const grid = container.querySelector('[data-testid="column-grid"]')
    expect(grid?.getAttribute('data-hero-column')).toBe('working') // NOT 'idle'

    const idleCol = container.querySelector('[data-column="idle"]')
    expect(idleCol?.getAttribute('data-hero')).toBeNull() // idle never carries the hero flag
    // The hero center is Working (empty here → its empty hint), prominent.
    const workingCol = container.querySelector('[data-column="working"]')
    expect(workingCol?.getAttribute('data-hero')).toBe('true')
  })

  it('all three columns ALWAYS render (with their 1.4 empty-state) regardless of the hero', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    // Every column section is present (none dropped), each keyed by data-column.
    for (const col of ['working', 'needs-you', 'idle']) {
      expect(container.querySelector(`[data-column="${col}"]`)).not.toBeNull()
    }
    // The empty columns keep their header + terse hint (never collapse).
    const needsYou = container.querySelector('[data-column="needs-you"]')
    expect(needsYou?.querySelector('[data-testid="empty-hint"]')?.textContent).toBe(
      'Nothing waiting. All quiet.'
    )
  })

  it('NO-PIN (AC-7): the board exposes no hero-select / drag affordance', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    // No draggable element, no hero-pin control of any kind.
    expect(container.querySelector('[draggable="true"]')).toBeNull()
    expect(container.querySelector('[data-testid="hero-pin"]')).toBeNull()
    expect(container.querySelector('[data-testid="hero-select"]')).toBeNull()
    // Cards are activation seams (role=button) but no column-move handle.
    expect(container.querySelector('[data-testid="column-drag-handle"]')).toBeNull()
  })
})

describe('Board — reduced-motion fallback (Story 1.5: AC-6, source-assert)', () => {
  it('the Board CSS module defines the compositor-only swap transition AND the reduced-motion fallback', () => {
    // jsdom does not run real CSS animation → assert against the module SOURCE (mirrors
    // emphasis.test.tsx). The swap eases ONLY compositor props (transform/opacity) and the
    // reduced-motion media query drops the transition (instant reposition).
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/board/Board.module.css'),
      'utf8'
    )
    // Compositor-only settle: transition on transform + opacity (NOT layout props / fr widths).
    expect(css).toMatch(/transition:\s*[\s\S]*transform/)
    expect(css).toMatch(/transition:\s*[\s\S]*opacity/)
    // The adaptive hero grid template (UX-DR7).
    expect(css).toContain('0.66fr 1.25fr 0.66fr')
    // The accessibility floor: reduced-motion drops the swap transition.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/transition:\s*none/)
    // Property discipline: the swap must NOT animate layout-thrashing props.
    expect(css).not.toMatch(/transition:[^;]*\b(top|left|margin|height|width)\b/)
  })
})

describe('Board — FR-9 in-app jump-to-card (Story 2.2: AC-5, AC-8)', () => {
  it('an attention:activate push for a PRESENT id flows window.attention.onActivate → store → selected card', () => {
    const bridges = stubBridges() // re-stub to capture this test's onActivate callback
    const st = boardStore.getState()
    st.applyWatchEvent(updated(1, 'w', 'working', 100, { sessionName: 'web' }))
    st.applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))

    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    // No card selected yet.
    expect(container.querySelector('[data-selected="true"]')).toBeNull()

    // Push the activate signal through the bridge the Board registered (mirrors main's push).
    act(() => bridges.pushActivate('w'))

    // Exactly the originating card renders the selected affordance.
    const selected = container.querySelectorAll('[data-selected="true"]')
    expect(selected.length).toBe(1)
    const workingCol = container.querySelector('[data-column="working"]')
    expect(workingCol?.querySelector('[data-selected="true"]')).not.toBeNull()
  })

  it('an attention:activate push for an ABSENT id is a NO-OP (no card selected; no raise)', () => {
    const bridges = stubBridges()
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    act(() => bridges.pushActivate('ghost')) // never on the board
    expect(container.querySelector('[data-selected="true"]')).toBeNull()
  })

  it('the stub bridge exposes onActivate (window.attention is wired in the preload seam)', () => {
    // The Board mounts window.attention.onActivate without throwing — proves the bridge exists.
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { unmount } = renderComponent(<Board />)
    cleanup = unmount
    expect(typeof (window as unknown as { attention: AttentionBridge }).attention.onActivate).toBe(
      'function'
    )
  })
})
