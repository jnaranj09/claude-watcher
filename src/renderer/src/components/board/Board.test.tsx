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
import { boardStore } from '../../stores/boardStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { renderComponent } from '../../test/renderComponent'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  Column,
  WatchEventsPayload,
  AttentionActivatePayload,
  Template,
  Tag
} from '../../../../shared/ipc/contract'
import { templatesStore } from '../../stores/templatesStore'
import { tagsStore } from '../../stores/tagsStore'

/** The shape the Board needs off `window.watch` (mirrors the preload WatchApi). */
interface WatchBridge {
  onEvents(cb: (payload: WatchEventsPayload) => void): () => void
  onStatus(cb: (status: { reconnecting: boolean }) => void): () => void
}

/** The shape the Board needs off `window.attention` (mirrors the preload AttentionApi). */
interface AttentionBridge {
  onActivate(cb: (payload: AttentionActivatePayload) => void): () => void
  onReminder(cb: (payload: { id: string }) => void): () => void
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

/** Reset the singleton store to a pristine pre-cold-load state. (No hero bookkeeping to
 *  reset — the hero is a module constant, `HERO_COLUMN`, not store state.) */
function resetStore(): void {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    coldLoaded: false,
    selectedId: null,
    searchQuery: ''
  })
  // Workspaces (Task 9a fix, review round 1, Finding 2) — reset the active workspace so a test
  // that switches it does not bleed into a later test in this file.
  workspacesStore.setState({ activeId: 'default' })
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
    },
    onReminder: () => () => {}
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
    workspaceId: string
    tagIds: string[]
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
      workspaceId: over.workspaceId ?? 'default',
      tagIds: over.tagIds ?? [],
      ...(over.pendingToolName !== undefined ? { pendingToolName: over.pendingToolName } : {})
    }
  }
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
  describe('Past sessions… beside + New session (empty board only)', () => {
    afterEach(() => act(() => boardStore.setState({ launchedTerminals: {} })))

    it('shows next to + New session and opens Past sessions', () => {
      boardStore.setState({ coldLoaded: true })
      const onOpenPastSessions = vi.fn()
      const { container, unmount } = renderComponent(
        <Board onOpenPastSessions={onOpenPastSessions} />
      )
      cleanup = unmount
      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="empty-board-past-sessions"]'
      )
      expect(btn?.textContent).toBe('Past sessions…')
      expect(btn?.parentElement?.querySelector('[data-testid="new-session"]')).not.toBeNull()
      act(() => btn?.click())
      expect(onOpenPastSessions).toHaveBeenCalledTimes(1)
    })

    it('both buttons share one row offset (the spacing sits on the row, not on one anchor)', () => {
      // A margin on NewSessionButton's primary anchor alone put `+ New session` 4px below
      // `Past sessions…` (drive run 2026-10-02). jsdom has no layout, so the CSS is the proxy.
      const read = (file: string): string =>
        readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const menu = read('src/renderer/src/components/NewSessionMenu/NewSessionMenu.module.css')
      const board = read('src/renderer/src/components/board/Board.module.css')
      expect(/\.anchorPrimary \{([^}]*)\}/.exec(menu)?.[1] ?? '').not.toMatch(/margin/)
      expect(/\.emptyBoardActions \{([^}]*)\}/.exec(board)?.[1] ?? '').toMatch(
        /margin-top: var\(--gap-inline\)/
      )
    })

    it('is absent without the seam', () => {
      boardStore.setState({ coldLoaded: true })
      const { container, unmount } = renderComponent(<Board />)
      cleanup = unmount
      expect(container.querySelector('[data-testid="empty-board-past-sessions"]')).toBeNull()
    })

    it('is absent while a launch is Starting…', () => {
      boardStore.setState({ coldLoaded: true })
      act(() => boardStore.getState().registerLaunchedTerminal('t-start', 'api', 'default'))
      const { container, unmount } = renderComponent(<Board onOpenPastSessions={vi.fn()} />)
      cleanup = unmount
      expect(container.querySelector('[data-testid="empty-board"]')?.textContent).toContain(
        'Starting…'
      )
      expect(container.querySelector('[data-testid="empty-board-past-sessions"]')).toBeNull()
    })
  })

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

  // Session templates — the empty-board `+ New session` opens the SAME popover as the header
  // button (folder / templates / Manage); the three seams stay injected, nothing is launched here.
  describe('+ New session opens the templates popover (seams injected, no launch built)', () => {
    const T1: Template = {
      id: 'a',
      name: 'api',
      cwd: '/api',
      model: null,
      permissionMode: null,
      effort: null,
      workspaceId: null,
      initialPrompt: null,
      params: [],
      favorite: false
    }
    const click = (container: Element, sel: string): void => {
      act(() => container.querySelector<HTMLButtonElement>(sel)?.click())
    }
    afterEach(() => act(() => templatesStore.getState().hydrate([])))

    it('click opens the popover; Pick a folder… fires onNewSession and closes it', () => {
      boardStore.setState({ coldLoaded: true })
      const onNewSession = vi.fn()
      const { container, unmount } = renderComponent(<Board onNewSession={onNewSession} />)
      cleanup = unmount
      expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
      click(container, '[data-testid="new-session"]')
      expect(document.querySelector('[data-testid="new-session-menu"]')).not.toBeNull()
      click(document.body, '[data-testid="menu-pick-folder"]')
      expect(onNewSession).toHaveBeenCalledTimes(1)
      expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    })

    it('a template row fires onPickTemplate with the template; Manage… fires onManageTemplates', () => {
      boardStore.setState({ coldLoaded: true })
      act(() => templatesStore.getState().hydrate([T1]))
      const onPickTemplate = vi.fn()
      const onManageTemplates = vi.fn()
      const { container, unmount } = renderComponent(
        <Board onPickTemplate={onPickTemplate} onManageTemplates={onManageTemplates} />
      )
      cleanup = unmount
      click(container, '[data-testid="new-session"]')
      click(document.body, '[data-template-id="a"]')
      expect(onPickTemplate).toHaveBeenCalledWith(T1)
      click(container, '[data-testid="new-session"]')
      click(document.body, '[data-testid="menu-manage"]')
      expect(onManageTemplates).toHaveBeenCalledTimes(1)
    })
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

describe('Board — the PINNED center hero (Needs-you always holds the center slot)', () => {
  it('ONLY Working sessions → Needs-you STILL holds the center (empty), Working is a flank', () => {
    // The retired Story-1.5 cascade promoted Working to the center whenever nothing needed
    // you. Now the center never moves: an empty gold column is the calm state.
    boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    const grid = container.querySelector('[data-testid="column-grid"]')
    expect(grid?.getAttribute('data-hero-column')).toBe('needs-you')

    const heroCol = container.querySelector('[data-column="needs-you"]')
    expect(heroCol?.getAttribute('data-hero')).toBe('true')
    expect(heroCol?.getAttribute('data-hero-accent')).toBe('needs-you')
    expect(heroCol?.querySelector('[data-prominent="true"]')).not.toBeNull()
    // Empty, so it shows its calm hint rather than any card.
    expect(heroCol?.querySelector('[data-testid="empty-hint"]')).not.toBeNull()

    // Working did NOT take the center — it is a flank with calm, non-prominent chrome.
    const workingCol = container.querySelector('[data-column="working"]')
    expect(workingCol?.getAttribute('data-hero')).toBeNull()
    expect(workingCol?.querySelector('[data-variant="calm"]')).not.toBeNull()
    expect(workingCol?.querySelector('[data-prominent="false"]')).not.toBeNull()

    // Idle is a flank (right slot), never the hero.
    const idleCol = container.querySelector('[data-column="idle"]')
    expect(idleCol?.getAttribute('data-hero')).toBeNull()
  })

  it('a Needs-you session appears → the center is unchanged and now carries the gold hero card', () => {
    const st = boardStore.getState()
    st.applyWatchEvent(updated(1, 'w', 'working', 100))
    st.applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    // No debounce to wait out any more — the center was already Needs-you.

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
    // Degenerate case: only idle sessions exist. Idle stays the right flank; the pinned
    // Needs-you center holds (empty).
    boardStore
      .getState()
      .applyWatchEvent(updated(1, 'i', 'idle', 300, { status: 'WaitingForInput' }))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    const grid = container.querySelector('[data-testid="column-grid"]')
    expect(grid?.getAttribute('data-hero-column')).toBe('needs-you') // NOT 'idle'

    const idleCol = container.querySelector('[data-column="idle"]')
    expect(idleCol?.getAttribute('data-hero')).toBeNull() // idle never carries the hero flag
    // The hero center is Needs-you (empty here → its empty hint), prominent.
    const needsYouCol = container.querySelector('[data-column="needs-you"]')
    expect(needsYouCol?.getAttribute('data-hero')).toBe('true')
    const workingCol = container.querySelector('[data-column="working"]')
    expect(workingCol?.getAttribute('data-hero')).toBeNull()
  })

  it('NO session population moves the center — every mix the old cascade flipped on', () => {
    // The retired cascade put Working in the center whenever the needs-you count hit 0.
    // Drive the board through each of those populations and assert the center never moves.
    // (This is the non-vacuous half of the pin: it renders real state, not the constant.)
    const populations: ReadonlyArray<{ label: string; apply: () => void }> = [
      { label: 'working only', apply: () => applyDelta(updated(1, 'w', 'working', 100)) },
      {
        label: '+ idle',
        apply: () => applyDelta(updated(2, 'i', 'idle', 300, { status: 'WaitingForInput' }))
      },
      {
        label: '+ needs-you',
        apply: () => applyDelta(updated(3, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
      },
      {
        label: 'needs-you emptied again',
        apply: () =>
          applyDelta({
            epoch: 4,
            event: {
              type: 'session.removed',
              id: 'n',
              sessionName: 's-n',
              projectPath: '/p/n'
            }
          })
      }
    ]

    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    for (const { label, apply } of populations) {
      apply()
      const grid = container.querySelector('[data-testid="column-grid"]')
      expect(grid?.getAttribute('data-hero-column'), label).toBe('needs-you')
      // …and the slot ORDER itself never re-orders: working · needs-you · idle.
      const order = [...container.querySelectorAll('[data-column]')].map((el) =>
        el.getAttribute('data-column')
      )
      expect(order, label).toEqual(['working', 'needs-you', 'idle'])
    }
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

describe('Board — the grid track sizes + NO motion (source-assert)', () => {
  it('the center hero is wider than a flank, but by a modest margin — and nothing animates', () => {
    // jsdom applies no CSS module styles → assert against the module SOURCE (mirrors
    // emphasis.test.tsx). Two things are pinned here:
    //   1. the hero/flank RATIO — the center leads without dwarfing the flanks;
    //   2. the absence of the retired swap motion — with the hero pinned, a column never
    //      changes slot, so a transition (and its reduced-motion opt-out) would be dead CSS.
    // Strip /* … */ comments first: the file EXPLAINS the removed motion in prose, and a
    // naive substring match would hit the explanation instead of a real declaration.
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/board/Board.module.css'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const tracks = /grid-template-columns:\s*([\d.]+)fr\s+([\d.]+)fr\s+([\d.]+)fr/.exec(css)
    expect(tracks).not.toBeNull()
    const [left, center, right] = [Number(tracks?.[1]), Number(tracks?.[2]), Number(tracks?.[3])]
    // Symmetric flanks; the hero is the widest track (it is still the hero).
    expect(left).toBe(right)
    expect(center).toBeGreaterThan(left)
    // …but no longer ~2x a flank (it was 1.25 vs 0.66 = 1.89x). Keep it under 1.7x so the
    // flanks stay comfortably readable — this is the assertion the size request pinned.
    expect(center / left).toBeLessThan(1.7)
    // No motion left: the pinned hero never moves, so no transition and no reduced-motion
    // opt-out for one. (Restore BOTH together if the swap ever comes back.)
    expect(css).not.toMatch(/transition:/)
    expect(css).not.toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toContain('will-change')
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

  it('an attention:activate push OPENS the session in its terminal, not just a selection (R29)', () => {
    const bridges = stubBridges()
    const st = boardStore.getState()
    st.applyWatchEvent(updated(1, 'w', 'working', 100, { sessionName: 'web' }))
    st.addCorrelation('w', 't-w')
    const { unmount } = renderComponent(<Board />)
    cleanup = unmount
    act(() => bridges.pushActivate('w'))
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('t-w')
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

// Task 9a fix (review round 1, Finding 2) — a WIRING-level guard. Every store-level test in
// boardStore.test.ts passes `workspaceId` explicitly, so none of them can catch a component that
// silently passes a hardcoded value (e.g. `'default'`) instead of
// `useWorkspaces(selectActiveWorkspaceId)` — the compiler forces *a* value, not the *right* one.
// This test proves the wiring: hydrate the ACTIVE workspace to something other than 'default',
// seed one card per workspace, and assert the board shows only the active workspace's card.
describe('Board — Task 9a fix: reads the ACTIVE workspace, not a hardcoded one (wiring guard)', () => {
  it("shows only the active workspace's card when TWO workspaces have cards", () => {
    workspacesStore.setState({ activeId: 'w2' })
    const st = boardStore.getState()
    st.applyWatchEvent(
      updated(1, 'in-w1', 'working', 100, { sessionName: 'w1-card', workspaceId: 'w1' })
    )
    st.applyWatchEvent(
      updated(1, 'in-w2', 'working', 200, { sessionName: 'w2-card', workspaceId: 'w2' })
    )

    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount

    // Non-vacuous both ways: w2's card renders, w1's card does not — a hardcoded 'default' (or
    // any wrong constant) would fail this in one direction or the other (most likely: an empty
    // board, since neither seeded session is in the 'default' workspace).
    expect(container.querySelector('[data-session-id="in-w2"]')).not.toBeNull()
    expect(container.querySelector('[data-session-id="in-w1"]')).toBeNull()
    expect(container.querySelector('[data-testid="empty-board"]')).toBeNull()
  })
})

describe('Board — the tag filter (spec §4.1, §4.3)', () => {
  const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
  const cardIds = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('[data-column] [data-session-id]')].map(
      (el) => el.getAttribute('data-session-id') ?? ''
    )

  beforeEach(() => {
    act(() => tagsStore.setState({ tags: [PROD], loaded: true, activeTagId: null }))
  })
  afterEach(() => {
    act(() => tagsStore.setState({ tags: [], loaded: false, activeTagId: null }))
  })

  it('shows only the cards carrying the filtered tag', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'tagged', 'working', 100, { tagIds: ['t-prod'] }))
    applyDelta(updated(1, 'plain', 'working', 101))
    expect(cardIds(container).sort()).toEqual(['plain', 'tagged'])
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    expect(cardIds(container)).toEqual(['tagged'])
  })

  it('carries the filter bar ABOVE the columns once the workspace has sessions', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    act(() => boardStore.getState().setReconnecting(false))
    expect(container.querySelector('[data-testid="filter-bar"]')).toBeNull()
    applyDelta(updated(1, 'plain', 'working', 100))
    const bar = container.querySelector('[data-testid="filter-bar"]')
    const grid = container.querySelector('[data-testid="column-grid"]')
    if (bar === null || grid === null) throw new Error('missing filter bar or column grid')
    expect(bar.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the filtered-empty board has no Past sessions… button', () => {
    const { container, unmount } = renderComponent(<Board onOpenPastSessions={vi.fn()} />)
    cleanup = unmount
    applyDelta(updated(1, 'plain', 'working', 100))
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    expect(container.querySelector('[data-testid="empty-board-filtered"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-board-past-sessions"]')).toBeNull()
  })

  it('names the tag when the filter hides every card — and keeps the bar to remove it', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'plain', 'working', 100))
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    const empty = container.querySelector('[data-testid="empty-board-filtered"]')
    expect(empty?.textContent).toContain('No sessions tagged prod.')
    expect(empty?.textContent).toContain('Remove the tag filter to see every session.')
    expect(container.querySelector('[data-testid="empty-board"]')).toBeNull()
    // The bar starts collapsed: its toggle says a filter is on, and opening it reaches the pill.
    expect(container.querySelector('[data-testid="filter-toggle-count"]')?.textContent).toBe('1')
    act(() => container.querySelector<HTMLElement>('[data-testid="filter-toggle"]')?.click())
    expect(container.querySelector('[data-testid="filter-pill-tag"]')).not.toBeNull()
  })

  it('keeps the plain empty board, with no filter bar, when the workspace has no sessions', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    act(() => boardStore.getState().setReconnecting(false))
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    expect(container.querySelector('[data-testid="empty-board"]')?.textContent).toContain(
      'No sessions yet.'
    )
    expect(container.querySelector('[data-testid="empty-board-filtered"]')).toBeNull()
    expect(container.querySelector('[data-testid="filter-bar"]')).toBeNull()
  })

  // Controller ruling (spec §4.3 applies design.md's three-empty-states rule to the board): a
  // column emptied ONLY by the tag filter must not claim "Nothing waiting. All quiet." — that
  // hint is a true statement about needs-you, and here it would be a false one about the filter.
  it('a column emptied ONLY by the filter names the tag — not the calm "All quiet." hint', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'tagged', 'working', 100, { tagIds: ['t-prod'] }))
    applyDelta(
      updated(1, 'untagged-needs-you', 'needs-you', 100, { status: 'NeedsAttention', tagIds: [] })
    )
    act(() => tagsStore.getState().setActiveTag('t-prod'))

    // Needs-you HAS a session, but not one carrying the filtered tag — the filtered hint.
    const needsYouCol = container.querySelector('[data-column="needs-you"]')
    expect(
      needsYouCol?.querySelector('[data-testid="empty-hint-filtered"]')?.textContent
    ).toContain('No sessions tagged prod here.')
    expect(needsYouCol?.querySelector('[data-testid="empty-hint"]')).toBeNull()

    // Idle has NO sessions at all (filtered or not) — the plain, unfiltered hint is unchanged.
    const idleCol = container.querySelector('[data-column="idle"]')
    expect(idleCol?.querySelector('[data-testid="empty-hint"]')?.textContent).toBe(
      'Nothing waiting.'
    )
    expect(idleCol?.querySelector('[data-testid="empty-hint-filtered"]')).toBeNull()
  })

  // Review finding E — the rail's own live region is inert/aria-hidden in board view, so the
  // Board's column-count announcement is the only in-app live region, and it must follow the tag
  // filter: a screen-reader user filtering by tag should hear that sessions are hidden, not just a
  // lower count with no explanation.
  it('the aria-live summary notes how many the tag filter hid', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'tagged', 'working', 100, { tagIds: ['t-prod'] }))
    applyDelta(updated(1, 'plain', 'working', 101))
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    const live = container.querySelector('[data-testid="live-announcer"]')
    expect(live?.textContent).toBe('0 need you, 1 working, 0 idle, 1 hidden by the tag filter')
  })

  it('with no filter, the summary text is unchanged (no trailing clause)', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'tagged', 'working', 100, { tagIds: ['t-prod'] }))
    applyDelta(updated(1, 'plain', 'working', 101))
    const live = container.querySelector('[data-testid="live-announcer"]')
    expect(live?.textContent).toBe('0 need you, 2 working, 0 idle')
  })

  it('a card draws its tags from the catalog, in TAG-LIST order', () => {
    const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
    act(() => tagsStore.setState({ tags: [DEPLOY, PROD], loaded: true, activeTagId: null }))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'tagged', 'working', 100, { tagIds: ['t-prod', 't-deploy'] }))
    const row = container.querySelector('[data-session-id="tagged"] [data-testid="card-tags"]')
    expect(
      [...(row?.querySelectorAll('[data-testid="tag-chip"]') ?? [])].map((c) => c.textContent)
    ).toEqual(['deploy', 'prod'])
  })
})

// The filter bar's search box narrows the board by card NAME, like the tag filter narrows it by tag,
// and every "why is this empty" sentence has to say which of the two is hiding the cards.
describe('Board — the search box', () => {
  const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
  const cardIds = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('[data-column] [data-session-id]')].map(
      (el) => el.getAttribute('data-session-id') ?? ''
    )
  const search = (query: string): void => act(() => boardStore.getState().setSearchQuery(query))

  beforeEach(() => {
    act(() => tagsStore.setState({ tags: [PROD], loaded: true, activeTagId: null }))
  })
  afterEach(() => {
    act(() => tagsStore.setState({ tags: [], loaded: false, activeTagId: null }))
  })

  it('shows only the cards whose name matches', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Deploy API' }))
    applyDelta(updated(1, 'b', 'working', 101, { sessionName: 'Review' }))
    search('deploy')
    expect(cardIds(container)).toEqual(['a'])
  })

  it('a column emptied ONLY by the search names the search — not the calm hint', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Deploy API' }))
    applyDelta(
      updated(1, 'b', 'needs-you', 100, { sessionName: 'Review', status: 'NeedsAttention' })
    )
    search('  deploy ')
    const needsYouCol = container.querySelector('[data-column="needs-you"]')
    expect(needsYouCol?.querySelector('[data-testid="empty-hint-filtered"]')?.textContent).toBe(
      'No sessions match “deploy” here.'
    )
    expect(needsYouCol?.querySelector('[data-testid="empty-hint"]')).toBeNull()
  })

  it('a column emptied by the search AND the tag names both', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Deploy API', tagIds: ['t-prod'] }))
    applyDelta(
      updated(1, 'b', 'needs-you', 100, { sessionName: 'Review', status: 'NeedsAttention' })
    )
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    search('deploy')
    const needsYouCol = container.querySelector('[data-column="needs-you"]')
    expect(needsYouCol?.querySelector('[data-testid="empty-hint-filtered"]')?.textContent).toBe(
      'No sessions tagged prod match “deploy” here.'
    )
  })

  it('a search that hides every card names the search, and keeps the bar to clear it', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Deploy API' }))
    search('zzz')
    const empty = container.querySelector('[data-testid="empty-board-filtered"]')
    expect(empty?.textContent).toContain('No sessions match “zzz”.')
    expect(empty?.textContent).toContain('Clear the search to see every session.')
    expect(container.querySelector<HTMLInputElement>('[data-testid="board-search"]')?.value).toBe(
      'zzz'
    )
  })

  it('search and tag hiding every card: the empty board names both', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Review', tagIds: ['t-prod'] }))
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    search('zzz')
    const empty = container.querySelector('[data-testid="empty-board-filtered"]')
    expect(empty?.textContent).toContain('No sessions tagged prod match “zzz”.')
    expect(empty?.textContent).toContain(
      'Clear the search or remove the tag filter to see every session.'
    )
  })

  it('the aria-live summary says how many the search hid', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Deploy API' }))
    applyDelta(updated(1, 'b', 'working', 101, { sessionName: 'Review' }))
    search('deploy')
    const live = container.querySelector('[data-testid="live-announcer"]')
    expect(live?.textContent).toBe('0 need you, 1 working, 0 idle, 1 hidden by the search')
  })

  it('with both on, the aria-live summary names both', () => {
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    applyDelta(updated(1, 'a', 'working', 100, { sessionName: 'Deploy API', tagIds: ['t-prod'] }))
    applyDelta(updated(1, 'b', 'working', 101, { sessionName: 'Review' }))
    act(() => tagsStore.getState().setActiveTag('t-prod'))
    search('deploy')
    const live = container.querySelector('[data-testid="live-announcer"]')
    expect(live?.textContent).toBe(
      '0 need you, 1 working, 0 idle, 1 hidden by the search and the tag filter'
    )
  })
})

// Review round 1, Finding 2 — the T-11 caller-scoping ruling (Column.tsx's `visibleTags(s.tags,
// session.workspaceId)`) had no covering test: nothing exercised the Tags… menu's actual offered
// list end-to-end, so a caller that passed the WHOLE catalog instead of the scoped one would have
// gone undetected.
describe('Board — the Tags… menu offers only global + the card’s own workspace (T-11)', () => {
  const GLOBAL: Tag = { id: 't-global', name: 'global-tag', color: 'slate', workspaceId: null }
  const OWN: Tag = { id: 't-own', name: 'own-tag', color: 'blue', workspaceId: 'default' }
  const OTHER: Tag = { id: 't-other', name: 'other-tag', color: 'rose', workspaceId: 'w2' }

  beforeEach(() => {
    act(() => tagsStore.setState({ tags: [GLOBAL, OWN, OTHER], loaded: true, activeTagId: null }))
  })
  afterEach(() => {
    act(() => tagsStore.setState({ tags: [], loaded: false, activeTagId: null }))
  })

  it('never offers a tag scoped to ANOTHER workspace; offers global + the card’s own', () => {
    const { container, unmount } = renderComponent(<Board onSetCardTags={vi.fn()} />)
    cleanup = unmount
    // The default (unnamed override) workspaceId from `updated()` IS 'default' — the same
    // workspace the fresh workspacesStore is active on (resetStore), so this card is "here".
    applyDelta(updated(1, 'card', 'working', 100))
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-session-id="card"] [data-testid="card-tags-button"]'
        )
        ?.click()
    )
    // data-testid queried, never textContent search (design.md).
    expect(container.querySelector('[data-testid="card-tag-picker-row-t-global"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="card-tag-picker-row-t-own"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="card-tag-picker-row-t-other"]')).toBeNull()
  })
})

describe('Board — public theme hooks', () => {
  it('marks the column group and each column body for themes', () => {
    const st = boardStore.getState()
    st.applyWatchEvent(updated(1, 'w', 'working', 100))
    st.applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    st.applyWatchEvent(updated(1, 'i', 'idle', 300, { status: 'WaitingForInput' }))
    const { container, unmount } = renderComponent(<Board />)
    cleanup = unmount
    expect(container.querySelectorAll('[data-column-grid]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-column] [data-column-body]')).toHaveLength(3)
  })
})
