// Story 3.2 (FR-11 / F6) → Story 3.4 (FR-16) — the Focused-session view tests (AC: #1, #3, #5).
//
// Story 3.4 ADDS the persistent attention rail alongside the terminal and keeps ALL app-launched
// terminals alive (the rail switch is a pure show/hide). The view now reads the visible terminal +
// the kept-alive set from the store (no `terminalId` prop). Asserts: the rail IS present (FR-16);
// the focused terminal renders; "← Board" → onBack; a rail click switches the visible terminal +
// acknowledges (no input sent).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { FocusedSession } from './FocusedSession'
import { boardStore, selectShellPane } from '../stores/boardStore'
import { deferred } from '../test/deferred'
import type { Column, SessionUpdatedEvent, WatchEventsPayload } from '../../../shared/ipc/contract'

let cleanup: (() => void) | undefined

/** A validated session.updated delta to seed the store (the rail's source). `extra` spreads onto
 *  the event, so a test can seed fields (e.g. `nameSyncPending`) beyond this helper's defaults. */
function updated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number,
  extra: Partial<SessionUpdatedEvent> = {}
): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: `s-${id}`,
      projectPath: `/p/${id}`,
      status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
      column,
      enteredColumnAt,
      pid: 1000,
      workspaceId: 'default',
      tagIds: [],
      ...extra
    }
  }
}

beforeEach(() => {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    viewMode: 'focused',
    focusedTerminalId: null,
    selectedId: null,
    acknowledgedById: {},
    terminalIdBySessionId: {},
    // Story 5.6 — reset the launched-terminals registry between tests (prevents cross-test leakage).
    launchedTerminals: {},
    shellPanes: {}
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
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
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
  // Story 3.5 (SM-2) — mock the telemetry bridge so acknowledgeSession() does not throw
  // in the test environment (window.telemetry is not wired by the preload in jsdom).
  // The mock just resolves: unit tests for the telemetry IPC are in the main-unit project.
  ;(window as unknown as { telemetry: unknown }).telemetry = {
    acknowledge: vi.fn(() => Promise.resolve())
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

function render(onBack: () => void = () => {}, onNewSession: () => void = () => {}): RenderResult {
  const r = renderComponent(<FocusedSession onBack={onBack} onNewSession={onNewSession} />)
  cleanup = r.unmount
  return r
}

describe('FocusedSession — Story 3.4 rail + kept-alive terminals (AC-1, AC-3, AC-5)', () => {
  it('renders the persistent attention RAIL alongside the terminal (FR-16)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    const r = render()
    expect(r.container.querySelector('[data-testid="attention-rail"]')).not.toBeNull()
  })

  it('renders the focused terminal (the optimistic launched terminalId from the store)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    const r = render()
    const term = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(term).not.toBeNull()
    expect(term?.getAttribute('data-terminal-id')).toBe('launch-term-1')
  })

  it('keeps ALL app-launched terminals ALIVE (correlated ∪ focused) — switching never recreates', () => {
    // One correlated session + the currently-focused (just-launched, not-yet-correlated) terminal.
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().openLaunchedTerminal('launch-b', 'b', 'default')
    const r = render()
    const terms = [...r.container.querySelectorAll('[data-testid="embedded-terminal"]')].map((el) =>
      el.getAttribute('data-terminal-id')
    )
    expect(new Set(terms)).toEqual(new Set(['launch-a', 'launch-b']))
  })

  it('the "← Board" affordance calls onBack (Esc-to-Board equivalent)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    const onBack = vi.fn()
    const r = render(onBack)
    const back = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-back"]')
    expect(back).not.toBeNull()
    back?.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('Board is an sm button: a line arrow icon, then the word Board; the label is unchanged', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    const r = render(vi.fn())
    const back = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-back"]')
    expect(back?.dataset['size']).toBe('sm')
    expect(back?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(back?.textContent).toBe('Board')
    expect(back?.getAttribute('aria-label')).toBe('Back to board (Esc)')
  })

  it('a rail-row click SWITCHES the visible terminal + ACKNOWLEDGES (no input sent — AC-3)', () => {
    // Seed two correlated sessions; focus the first.
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().addCorrelation('b', 'launch-b')
    boardStore.getState().switchTerminal('launch-a')
    const r = render()

    // Click the rail row for session 'b'.
    const rowB = r.container.querySelector<HTMLButtonElement>('[data-session-id="b"]')
    expect(rowB).not.toBeNull()
    rowB?.click()

    // The visible terminal switched to b's terminal; b was acknowledged.
    expect(boardStore.getState().focusedTerminalId).toBe('launch-b')
    expect(boardStore.getState().acknowledgedById['b']).not.toBeUndefined()
    // window.terminal had NO input/write call — switching is pure view-state (the open() fake only
    // wires the port; there is no input API on the bridge, by construction — alert-only, FR-9).
  })

  // Story 6.1 — the focused surface threads onNewSession down to EmbeddedTerminal, so the dead
  // pane's ONE "New session" button runs App's launch flow (NOT the plain re-open fallback).
  it('threads onNewSession to the terminal: the dead pane button calls it (Story 6.1)', () => {
    // A capturing onExit fake so the test can flip the terminal into its dead pane.
    const exitCbs: Array<(info: { terminalId: string; exitCode: number }) => void> = []
    ;(window as unknown as { terminal: unknown }).terminal = {
      open: vi.fn(() => () => {}),
      resize: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      onExit: vi.fn((cb: (info: { terminalId: string; exitCode: number }) => void) => {
        exitCbs.push(cb)
        return () => {}
      })
    }
    boardStore.getState().openLaunchedTerminal('launch-dead-thread', 'dead-thread', 'default')
    const onNewSession = vi.fn()
    const r = render(() => {}, onNewSession)

    // Exit the focused terminal → its dead pane shows the ONE New-session button.
    act(() => exitCbs.forEach((cb) => cb({ terminalId: 'launch-dead-thread', exitCode: 0 })))
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="dead-new-session"]')
    expect(btn).not.toBeNull()

    act(() => {
      btn?.click()
    })
    // Session-templates parity (2026-09-05): the dead button now opens the SAME popover as the
    // header, so the folder flow is its `Pick a folder…` row. The menu is portaled to
    // document.body (the terminal frame is `overflow: clip`).
    act(() =>
      (document.body.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    // The threaded prop fired (App's handleNewSession flow), NOT the re-open fallback.
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  // Session-templates parity — the focused surface threads the OTHER TWO seams too, so the
  // dead pane's popover reaches the same template / Manage handlers as the header button.
  it('threads onPickTemplate and onManageTemplates to the terminal (dead-pane popover)', () => {
    const exitCbs: Array<(info: { terminalId: string; exitCode: number }) => void> = []
    ;(window as unknown as { terminal: unknown }).terminal = {
      open: vi.fn(() => () => {}),
      resize: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      onExit: vi.fn((cb: (info: { terminalId: string; exitCode: number }) => void) => {
        exitCbs.push(cb)
        return () => {}
      })
    }
    boardStore.getState().openLaunchedTerminal('launch-dead-tpl', 'dead-tpl', 'default')
    const onManageTemplates = vi.fn()
    const r = renderComponent(
      <FocusedSession
        onBack={() => {}}
        onNewSession={() => {}}
        onPickTemplate={vi.fn()}
        onManageTemplates={onManageTemplates}
      />
    )
    cleanup = r.unmount

    act(() => exitCbs.forEach((cb) => cb({ terminalId: 'launch-dead-tpl', exitCode: 0 })))
    act(() =>
      (r.container.querySelector('[data-testid="dead-new-session"]') as HTMLButtonElement).click()
    )
    act(() =>
      (document.body.querySelector('[data-testid="menu-manage"]') as HTMLButtonElement).click()
    )
    expect(onManageTemplates).toHaveBeenCalledTimes(1)
  })

  it('shows the focused session name in the bar with the ⟳ mark while a rename is pending', () => {
    act(() => {
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'working', 10, { nameSyncPending: true }))
      boardStore.setState({
        terminalIdBySessionId: { a: 'term-a' },
        focusedTerminalId: 'term-a',
        launchedTerminals: {
          'term-a': { terminalId: 'term-a', launchedAt: 1, label: 's-a', workspaceId: 'default' }
        }
      })
    })
    const r = renderComponent(<FocusedSession onBack={vi.fn()} onNewSession={vi.fn()} />)
    cleanup = r.unmount
    expect(r.container.querySelector('[data-testid="focused-title"]')?.textContent).toContain('s-a')
    expect(r.container.querySelector('[data-testid="name-sync-pending"]')).not.toBeNull()
  })

  // Option 3 (2026-09-23): the name is the bar's TITLE, a breadcrumb step after `← Board`, with the
  // session's status dot — not a stray label at the right edge beside Archive/Delete.
  it('draws the name as a breadcrumb title after ← Board, with the status dot, before the hint', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 10))
      boardStore.setState({
        terminalIdBySessionId: { a: 'term-a' },
        focusedTerminalId: 'term-a',
        launchedTerminals: {
          'term-a': { terminalId: 'term-a', launchedAt: 1, label: 's-a', workspaceId: 'default' }
        }
      })
    })
    const r = renderComponent(<FocusedSession onBack={vi.fn()} onNewSession={vi.fn()} />)
    cleanup = r.unmount
    // The hint draws only while focus is OUTSIDE the terminal (R1) — put it on ← Board.
    act(() => {
      r.container.querySelector<HTMLButtonElement>('[data-testid="focused-back"]')?.focus()
    })
    const title = r.container.querySelector('[data-testid="focused-title"]')
    expect(
      title?.querySelector('[data-status="needs-you"] [data-testid="status-dot"]')
    ).not.toBeNull()
    const bar = title?.parentElement
    const order = [...(bar?.children ?? [])].map(
      (el) => el.getAttribute('data-testid') ?? el.textContent?.trim()
    )
    expect(order.indexOf('focused-back')).toBeLessThan(order.indexOf('focused-title'))
    expect(order.indexOf('focused-title')).toBeLessThan(order.indexOf('focused-hint'))
    expect(order.indexOf('focused-hint')).toBeLessThan(order.indexOf('focused-archive'))
  })

  it('a rail row whose binding has NOT landed is alert-only: acknowledges but does NOT switch', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().openLaunchedTerminal('launch-other', 'other', 'default') // focused = some other terminal
    // session 'a' has NO terminalIdBySessionId binding yet.
    const r = render()
    const rowA = r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')
    rowA?.click()
    // Acknowledged (the operator saw it) but the visible terminal did NOT switch (no binding).
    expect(boardStore.getState().acknowledgedById['a']).not.toBeUndefined()
    expect(boardStore.getState().focusedTerminalId).toBe('launch-other')
  })
})

// ---------------------------------------------------------------------------
// Past sessions (D-3/D-5) — the Archive + Delete focused-bar buttons (replaced Story 4.3's
// single ⏹ Stop session button)
// ---------------------------------------------------------------------------

describe('FocusedSession — Past sessions Archive + Delete header buttons (D-3, D-5)', () => {
  beforeEach(() => {
    ;(window as unknown as { launch: unknown }).launch = {
      archiveSession: vi.fn(() => Promise.resolve()),
      deleteSession: vi.fn(() => Promise.resolve())
    }
  })

  it('renders both the Archive and the Delete button in the focused header', () => {
    boardStore.getState().openLaunchedTerminal('launch-exit-test', 'exit-test', 'default')
    const r = render()
    expect(r.container.querySelector('[data-testid="focused-archive"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="focused-delete"]')).not.toBeNull()
  })

  it('clicking Archive calls window.launch.archiveSession(focusedTerminalId) and does NOT open the confirm', () => {
    boardStore.getState().openLaunchedTerminal('launch-archive-click', 'archive-click', 'default')
    const r = render()
    const archiveBtn = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="focused-archive"]'
    )
    expect(archiveBtn).not.toBeNull()

    archiveBtn?.click()

    expect(window.launch.archiveSession).toHaveBeenCalledWith('launch-archive-click')
    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('Archive is busy until main answers, and a second press sends nothing', async () => {
    const pending = deferred<void>()
    const archiveSession = vi.fn(() => pending.promise)
    ;(window as unknown as { launch: { archiveSession: unknown } }).launch.archiveSession =
      archiveSession
    boardStore.getState().openLaunchedTerminal('launch-archive-busy', 'archive-busy', 'default')
    const r = render()
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-archive"]')
    act(() => btn?.click())
    expect(btn?.getAttribute('aria-busy')).toBe('true')
    act(() => btn?.click())
    expect(archiveSession).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(undefined)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(btn?.hasAttribute('aria-busy')).toBe(false)
  })

  it('clicking Delete opens the confirm with { terminalId, sessionId, sessionName } and calls nothing on the bridge', () => {
    // Correlated: sessionId + sessionName come off the bound session.
    boardStore.getState().applyWatchEvent(updated(1, 'sess-corr', 'working', 100))
    boardStore.getState().addCorrelation('sess-corr', 'launch-corr-term')
    boardStore.getState().switchTerminal('launch-corr-term')
    const r = render()
    const deleteBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-delete"]')
    deleteBtn?.click()

    const payload = boardStore.getState().stopConfirm
    expect(payload).toEqual({
      terminalId: 'launch-corr-term',
      sessionId: 'sess-corr',
      sessionName: 's-sess-corr'
    })
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
    expect(window.launch.deleteSession).not.toHaveBeenCalled()
  })

  it('clicking Delete degrades gracefully to a null sessionId + the bare terminalId name when pre-correlation', () => {
    boardStore.getState().openLaunchedTerminal('launch-pre-corr', 'pre-corr', 'default')
    const r = render()
    const deleteBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-delete"]')
    deleteBtn?.click()

    const payload = boardStore.getState().stopConfirm
    expect(payload).toEqual({
      terminalId: 'launch-pre-corr',
      sessionId: null,
      sessionName: 'launch-pre-corr'
    })
  })
})

// The terminal column used to end in an empty 40px `.toolStrip` (a reserved slot for a future
// toolbar, 2026-06-24). It read as a thick bottom margin under a frame with thin gaps on its other
// three sides, and a theme could not take it back, so it was removed from the app (2026-09-22).
// The terminal wrap is the column's LAST box: nothing sits between it and the column's bottom.
describe('FocusedSession — no reserved strip under the terminal', () => {
  it('.terminalWrap is the last child of .main', () => {
    boardStore.getState().openLaunchedTerminal('launch-strip-test', 'strip-test', 'default')
    const r = render()
    const focused = r.container.querySelector('[data-testid="focused-session"]')
    // .main is the second child of the focused wrapper (after AttentionRail).
    const main = focused?.children[1] as HTMLElement | undefined
    expect(main?.lastElementChild?.className).toContain('terminalWrap')
  })

  it('the stylesheet reserves no bottom strip', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './FocusedSession.module.css'),
      'utf8'
    )
    expect(css).not.toMatch(/toolStrip|--terminal-tools-h/)
  })
})

// The rail's "Sessions" header and this view's Board bar sit SIDE BY SIDE, each drawing its own 1px
// bottom border. Unequal heights put a visible STEP in that line exactly at the rail's edge, where
// the eye crosses from the rail into the terminal. They were 41px and 45px, and the step was
// reported from a screenshot — nothing in the suite noticed, because each module looked fine alone.
//
// So the guard has to span BOTH modules: assert each sets its height from the SAME token. jsdom
// does no layout, so a computed-height comparison is not available here; the shared token is the
// thing that makes them provably equal rather than coincidentally close.
describe('FocusedSession — the rail header and the Board bar end on the same line', () => {
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  const heightOf = (css: string, selector: RegExp): string | undefined =>
    /(?:^|[^-])height:\s*([^;]+);/.exec(selector.exec(css)?.[1] ?? '')?.[1]?.trim()

  it('both bars take their height from --topbar-height, and neither hardcodes one', () => {
    const bar = heightOf(readCss('./FocusedSession.module.css'), /^\.bar\s*\{([^}]*)/m)
    const railHeader = heightOf(
      readCss('../components/attention/AttentionRail.module.css'),
      /^\.header\s*\{([^}]*)/m
    )
    expect(bar).toBe('var(--topbar-height)')
    expect(railHeader).toBe('var(--topbar-height)')
    // Same token on both sides is the whole point — pin the equality itself, not just the values,
    // so swapping one for a literal that happens to match today still fails here.
    expect(railHeader).toBe(bar)
  })
})

// The bar's three exits are the shared `components/Button` (design.md): Back is the outlined
// `secondary`; Archive is the same at the rail's `sm` height (reversible, so no danger treatment);
// Delete is `danger` — red at rest, filled on hover/focus — at the same height, so the risky exit
// reads differently at a glance. Before this, Delete wore Archive's box plus a danger colour
// override, and a hover-specificity tie let Archive's grey border draw round the red fill; Button
// owns the hover now, so the guard is that these are Button and that this module draws no button.
describe('FocusedSession — the bar buttons are the shared Button', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), './FocusedSession.module.css'),
    'utf8'
  )

  it('Back is secondary sm (one 28px bar); Archive secondary sm; Delete danger sm', () => {
    boardStore.getState().openLaunchedTerminal('launch-button-test', 'button-test', 'default')
    const r = render()
    const button = (testId: string): HTMLButtonElement => {
      const el = r.container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
      if (el === null) throw new Error(`missing ${testId}`)
      return el
    }
    expect(button('focused-back').dataset).toMatchObject({ variant: 'secondary', size: 'sm' })
    expect(button('focused-archive').dataset).toMatchObject({ variant: 'secondary', size: 'sm' })
    expect(button('focused-delete').dataset).toMatchObject({ variant: 'danger', size: 'sm' })
    expect(button('focused-delete').hasAttribute('data-armed')).toBe(false)
  })

  it('the module declares no button style of its own', () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(selectors).not.toMatch(/\.(backButton|archiveButton|deleteButtonFocused)\b/)
  })
})

// The active tab is a NOTCH cut through the rail, showing the ground the terminal floats on. Two
// separate declarations in two different modules make that work, and each looks individually
// tidy-uppable — which is how a notch quietly gets a wall built back across it.
describe('FocusedSession — the wall stops at the active tab', () => {
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  const block = (css: string, selector: RegExp): string => selector.exec(css)?.[1] ?? ''

  it('the rail draws a wall, and the tab is wide enough to break it', () => {
    const rail = readCss('../components/attention/AttentionRail.module.css')
    // The wall no longer lives on `.rail` itself — it is painted by three tiled layers
    // (`.rail::before`/`.rail::after` above/below the pinned slot, `.pinnedSlot::before` for the
    // slot) so the active tab can be a genuine NOTCH cut out of it (a mask) rather than a
    // paint-over. `.rail` keeps no background/border of its own — see its comment.
    const railChrome = block(rail, /^\.rail::before,\s*\n\.rail::after\s*\{([^}]*)/m)
    const pinnedChrome = block(rail, /^\.pinnedSlot::before\s*\{([^}]*)/m)
    const active = block(rail, /^\.active\s*\{([^}]*)/m)

    // The wall exists, on the tiling layers...
    expect(railChrome).toMatch(/background:\s*var\(--bg-surface\)/)
    expect(railChrome).toMatch(/border-right:\s*1px solid var\(--border\)/)
    // ...continued through the slot's own span by two wall stubs (the linear-gradient layers), one
    // above the shoulders and one below.
    expect(pinnedChrome.match(/linear-gradient\(var\(--border\), var\(--border\)\)/g)?.length).toBe(
      2
    )
    // ...and the rail must not clip, or the tab can never reach the pixel the wall occupies:
    // `overflow: hidden` clips descendants to the PADDING box, which stops short of the border.
    expect(block(rail, /^\.rail\s*\{([^}]*)/m)).toMatch(/^\s*overflow:\s*visible/m)
    // The tab carries no right border of its own — it stays open toward the terminal...
    expect(active).toMatch(/border-right-width:\s*0/)
    // ...and is widened by the list padding PLUS the wall's 1px, MINUS `--rounded-md`: the box now
    // stops where the shoulder ARC begins (the arc is painted by `.pinnedSlot::before`, not by this
    // row), which is what breaks the line for exactly this tab's height.
    expect(active).toMatch(/width:\s*calc\(100% \+ var\(--space-2\) \+ 1px - var\(--rounded-md\)\)/)
    // Right corners SQUARE — the curve there flares OUTWARD and is painted by the slot's chrome
    // layer, not by the row.
    expect(active).toMatch(/border-radius:\s*var\(--rounded-md\) 0 0 var\(--rounded-md\)/)
    // ...which need this row to be their containing block.
    expect(active).toMatch(/position:\s*relative/)

    // The tab's fill must be the SAME TOKEN the ground around the terminal paints, not a lookalike:
    // they sit edge to edge through the break, so any drift shows up as a seam.
    expect(active).toMatch(/background:\s*var\(--bg-base\)/)
    expect(readCss('./FocusedSession.module.css')).toMatch(
      /\.focused\s*\{[^}]*background:\s*var\(--bg-base\)/s
    )
  })

  it('keeps the pinned slot OUT of the scroll container, or the tab cannot reach the wall', () => {
    const rail = readCss('../components/attention/AttentionRail.module.css')
    // `.scroll` is `overflow-y: auto`, and CSS forces `overflow-x: visible` to compute to `auto`
    // when the other axis is not visible — so a tab inside it can never overflow sideways. This is
    // the structural half of the notch, and it is invisible from the stylesheet alone.
    expect(block(rail, /^\.scroll\s*\{([^}]*)/m)).toMatch(/overflow-y:\s*auto/)
    expect(rail).toMatch(/^\.pinnedSlot\s*\{/m)
    const tsx = readCss('../components/attention/AttentionRail.tsx')
    const slotAt = tsx.indexOf('styles.pinnedSlot')
    const scrollAt = tsx.indexOf('data-testid="rail-scroll"')
    expect(slotAt).toBeGreaterThan(-1)
    expect(slotAt).toBeLessThan(scrollAt)
  })

  it('draws the header/bar seam ONCE — the rail owns it, the bar must not double it', () => {
    // The rail header and the Board bar are both `--bg-surface`, so the seam between them has to be
    // drawn — but by exactly ONE side. The rail's wall runs the full height (now painted by the
    // three tiled chrome layers, not a `.rail` border — see the previous test) and already covers
    // this strip. A `border-left` on the bar does not overlap it: the rail's line is the last pixel
    // INSIDE its `--rail-width` box, the bar's the first pixel outside, so the two stack into a 2px
    // seam across the top strip that thins to 1px below the bar. The bar legitimately carried this
    // border while the rail had no wall; the wall's return turned it into a duplicate, and the
    // widening is most visible exactly where the eye crosses from the rail into the terminal.
    const railChrome = block(
      readCss('../components/attention/AttentionRail.module.css'),
      /^\.rail::before,\s*\n\.rail::after\s*\{([^}]*)/m
    )
    expect(railChrome).toMatch(/border-right:\s*1px solid var\(--border\)/)

    // Declaration form, not a bare substring — the bar's own comment explains why it has no
    // border-left, and a naive /border-left/ would match that prose and pass on a real regression.
    const barBlock = block(readCss('./FocusedSession.module.css'), /^\.bar\s*\{([^}]*)/m)
    expect(barBlock).not.toMatch(/^\s*border-left\s*:/m)
  })
})

// The tab's SHOULDERS: where its top and bottom borders sweep away from the row and turn into the
// rail's wall, the way a browser tab meets its toolbar. This is a CONCAVE corner — the tab's
// surface bulging outward while the rail curves in to meet it — and `border-radius` cannot draw
// one: a radius bites into a box, it does not bulge out of it. So each shoulder is painted.
//
// The PINNED row's shoulders moved off the row entirely (Story: rail-wall) — they are now two
// `radial-gradient` RING layers on `.pinnedSlot::before`, the slot's own masked chrome (see that
// rule's long comment), painted UNDER the mask that cuts the tab's silhouette out. The STARTING
// row still has no chrome layer of its own (it lives inside `.scroll`, which clips it anyway), so
// it keeps the OLD paint-over pseudo-elements, renamed `.startingRow.active::before/::after`.
//
// Nothing about either mechanism is guessable from the declarations alone, which is exactly why
// it needs a test: the obvious "simplification" for the ring is to delete it and put a
// corner-radius on the row's own right-hand corners (which silently turns the shape inward); for
// the starting row it is to "tidy" the flares away now the pinned tab has a mask, which would
// leave that row's shoulders unpainted for the whole time it exists.
describe('FocusedSession — the active tab flares outward into the wall', () => {
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  const rail = (): string => readCss('../components/attention/AttentionRail.module.css')

  it('the PINNED tab: paints both shoulders as ring gradients on the slot chrome layer, not corner radii', () => {
    const css = rail()
    const chrome = /^\.pinnedSlot::before\s*\{([^}]*)/m.exec(css)?.[1] ?? ''
    expect(chrome, '.pinnedSlot::before must exist').not.toBe('')
    // A corner-radius cut would not need — or produce — this three-stop ring shape; there is no
    // `border-radius` anywhere in the slot's chrome layer.
    expect(chrome).not.toMatch(/border-radius/)

    // Two shoulders — the corner FURTHEST from the tab, top (`circle at 0 0`) and bottom
    // (`circle at 0 100%`) — each a 1px `--border` ring between `--rounded-md - 1px` and
    // `--rounded-md`, `transparent` on both sides: inside is the surface the row's own rounded
    // corner blends over (kept by the mask), outside is the hole the mask cuts away.
    for (const at of ['circle at 0 0', 'circle at 0 100%']) {
      const start = chrome.indexOf(at)
      expect(start, at).toBeGreaterThan(-1)
      const ring = chrome.slice(start, start + 200)
      expect(ring).toMatch(/transparent\s+calc\(var\(--rounded-md\) - 1px\)/)
      expect(ring).toMatch(
        /var\(--border\)\s+calc\(var\(--rounded-md\) - 1px\)\s+var\(--rounded-md\)/
      )
      expect(ring).toMatch(/transparent\s+var\(--rounded-md\)/)
    }
  })

  it('the STARTING row keeps its OLD paint-over shoulders, renamed but otherwise unchanged', () => {
    const css = rail()
    const shared =
      /\.startingRow\.active::before,\s*\.startingRow\.active::after\s*\{([^}]*)\}/.exec(
        css
      )?.[1] ?? ''

    // Parked outside the tab's right edge, and decorative only — the row's hit area must not grow.
    expect(shared).toMatch(/position:\s*absolute/)
    expect(shared).toMatch(/right:\s*0/)
    expect(shared).toMatch(/pointer-events:\s*none/)

    // Selectors matched EXACTLY. A loose `/\.startingRow\.active::after\s*\{/` also matches the
    // shared rule above, whose second selector line begins with the same text — and then reads
    // the wrong body.
    const ruleFor = (selector: string): string => {
      for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if ((sel ?? '').trim() === selector) return body ?? ''
      }
      return ''
    }
    for (const selector of ['.startingRow.active::before', '.startingRow.active::after']) {
      const block = ruleFor(selector)
      expect(block, `${selector} must exist as its own rule`).not.toBe('')
      expect(block).toMatch(/radial-gradient/)
      // Three bands, in this order: the rail continuing over the flare, the 1px arc, then the
      // tab's own surface flared out to the wall. Get the order wrong and the curve inverts. This
      // row still paints `--bg-base` as a literal cover — it is the ONE place that is still true
      // (see the rule's own comment: it is transient, inside `.scroll`, and has no mask of its
      // own).
      const stops = block.indexOf('--bg-surface') < block.indexOf('--border')
      expect(stops, 'rail band must precede the arc band').toBe(true)
      expect(block.indexOf('--border')).toBeLessThan(block.indexOf('--bg-base'))
    }
  })

  it('keeps the shoulders when the rail is collapsed — the wall is there in both states', () => {
    const css = rail()
    // These were switched OFF collapsed while a collapsed active row was a centred square with rail
    // on both sides: no wall beside it to flare into, and the gradients would have painted two grey
    // smudges against the gutter. The collapsed row grows onto the wall now, so the reason is gone
    // and the reset with it. This asserts the reset stays gone — re-adding it is a one-line change
    // that silently drops half the shape in one of the two states.
    expect(css).not.toMatch(
      /\.collapsed \.startingRow\.active::before,\s*\.collapsed \.startingRow\.active::after\s*\{[^}]*content:\s*none/s
    )
    // The shoulders only mean anything if the collapsed tab actually reaches the wall: the flares
    // sit at the tab's right edge (`right: 0`), so a tab that stopped in the gutter would park them
    // in mid-rail. That last `+ 1px` is the wall's pixel.
    const collapsedTab =
      /\.collapsed \.row\.active,\s*\.collapsed \.startingRow\.active\s*\{([^}]*)\}/s.exec(
        css
      )?.[1] ?? ''
    expect(collapsedTab).toMatch(/width:\s*calc\(100% - var\(--rail-tab-inset\) \+ 1px\)/)
    expect(collapsedTab).toMatch(/margin-right:\s*-1px/)
  })
})

// Focused-view keys (R1, R27, R10 — decision b): claude keeps every key while its terminal has
// focus, so the view must PUT focus there on every switch (R10), and the bar may only promise a
// key that works where focus is.
describe('FocusedSession — terminal focus and the bar hint (R1, R10, R27)', () => {
  function xtermOf(r: RenderResult, terminalId: string): HTMLElement {
    const el = r.container.querySelector<HTMLElement>(
      `[data-testid="embedded-terminal"][data-terminal-id="${terminalId}"] .xterm`
    )
    if (!el) throw new Error(`xterm for ${terminalId} did not open`)
    return el
  }

  function seedTwo(): void {
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().addCorrelation('b', 'launch-b')
    boardStore.getState().switchTerminal('launch-a')
  }

  it('R10: a rail-row click moves DOM focus into the newly shown terminal', () => {
    seedTwo()
    const r = render()
    const rowB = r.container.querySelector<HTMLButtonElement>('[data-session-id="b"]')
    expect(rowB).not.toBeNull()
    // A real click focuses the row first (mousedown); that is where focus was left before R10.
    act(() => {
      rowB?.focus()
      rowB?.click()
    })
    expect(boardStore.getState().focusedTerminalId).toBe('launch-b')
    expect(xtermOf(r, 'launch-b').contains(document.activeElement)).toBe(true)
  })

  it('R10: coming back from the board to the SAME terminal focuses it again', () => {
    seedTwo()
    const r = render()
    act(() => {
      boardStore.getState().showBoard()
    })
    act(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    expect(xtermOf(r, 'launch-a').contains(document.activeElement)).toBe(false)
    act(() => {
      boardStore.getState().activateCard('a')
    })
    expect(xtermOf(r, 'launch-a').contains(document.activeElement)).toBe(true)
  })

  it('a hidden terminal (an API create, registry only) never takes focus', () => {
    seedTwo()
    const r = render()
    act(() => {
      boardStore.getState().switchTerminal('launch-a')
    })
    act(() => {
      boardStore.getState().registerLaunchedTerminal('launch-api', 'api', 'default')
    })
    expect(xtermOf(r, 'launch-api').contains(document.activeElement)).toBe(false)
    expect(xtermOf(r, 'launch-a').contains(document.activeElement)).toBe(true)
  })

  it('"Esc to return" shows only while focus is OUTSIDE the terminal (Esc is claude’s inside it)', () => {
    seedTwo()
    const r = render()
    const hint = (): Element | null => r.container.querySelector('[data-testid="focused-hint"]')
    // The view put focus in the terminal: Esc belongs to claude, so no Esc hint.
    expect(xtermOf(r, 'launch-a').contains(document.activeElement)).toBe(true)
    expect(hint()).toBeNull()
    // Focus leaves the terminal (the ← Board button): now Esc does return.
    const back = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-back"]')
    act(() => {
      back?.focus()
    })
    expect(hint()?.textContent).toBe('Esc to return')
    // And back into the terminal: gone again.
    act(() => {
      xtermOf(r, 'launch-a').querySelector<HTMLTextAreaElement>('textarea')?.focus()
    })
    expect(hint()).toBeNull()
  })

  it('R27: the Archive button promises no chord (Ctrl+W archives nothing)', () => {
    seedTwo()
    const r = render()
    const archive = r.container.querySelector('[data-testid="focused-archive"]')
    expect(archive?.getAttribute('aria-label')).toBe('Archive this session')
    expect(r.container.textContent).not.toContain('Ctrl+W')
  })
})

describe('FocusedSession — the >_ Shell button (card shell pane)', () => {
  function stubShell(
    open: (id: string) => Promise<{ terminalId: string }>
  ): ReturnType<typeof vi.fn> {
    const fn = vi.fn(open)
    ;(window as unknown as { shell: unknown }).shell = { open: fn }
    return fn
  }
  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('renders unlit, titled Open shell, and opens the pane for the FOCUSED terminal', async () => {
    const open = stubShell(() => Promise.resolve({ terminalId: 'launch-a:shell' }))
    boardStore.getState().openLaunchedTerminal('launch-a', 'a', 'default')
    const r = render()
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-shell"]')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toContain('Shell')
    expect(btn?.hasAttribute('data-lit')).toBe(false)
    expect(btn?.getAttribute('title')).toBe('Open shell')
    act(() => btn?.click())
    await flush()
    expect(open).toHaveBeenCalledWith('launch-a')
    const pane = r.container.querySelector(
      '[data-terminal-id="launch-a"] [data-testid="shell-pane"]'
    )
    expect(pane?.getAttribute('data-visible')).toBe('true')
    expect(pane?.querySelector('[data-terminal-id="launch-a:shell"]')).not.toBeNull()
    expect(btn?.hasAttribute('data-lit')).toBe(true)
    expect(btn?.getAttribute('title')).toBe('Hide shell')
  })

  it('open focuses the shell; hide focuses claude again; the hidden shell stays mounted', async () => {
    stubShell(() => Promise.resolve({ terminalId: 'launch-a:shell' }))
    boardStore.getState().openLaunchedTerminal('launch-a', 'a', 'default')
    const r = render()
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-shell"]')
    act(() => btn?.click())
    await flush()
    const shellFrame = r.container.querySelector(
      '[data-terminal-id="launch-a:shell"]'
    ) as HTMLElement
    expect(shellFrame.querySelector('.xterm')?.contains(document.activeElement)).toBe(true)
    act(() => btn?.click())
    await flush()
    const parentFrame = r.container.querySelector(
      '[data-testid="embedded-terminal"][data-terminal-id="launch-a"]'
    ) as HTMLElement
    // Focus is back in claude's half: inside the parent frame, outside the shell's.
    const parentMain = parentFrame.querySelector('[data-testid="terminal-main"]') as HTMLElement
    expect(parentMain.querySelector('.xterm')?.contains(document.activeElement)).toBe(true)
    expect(shellFrame.contains(document.activeElement)).toBe(false)
    expect(r.container.querySelector('[data-terminal-id="launch-a:shell"]')).not.toBeNull()
    expect(
      r.container.querySelector('[data-testid="shell-pane"]')?.getAttribute('data-visible')
    ).toBe('false')
    expect(btn?.hasAttribute('data-lit')).toBe(false)
  })

  it('is busy while main answers, so a double click opens ONE shell', async () => {
    const d = deferred<{ terminalId: string }>()
    const open = stubShell(() => d.promise)
    boardStore.getState().openLaunchedTerminal('launch-a', 'a', 'default')
    const r = render()
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-shell"]')
    act(() => btn?.click())
    act(() => btn?.click())
    expect(btn?.getAttribute('aria-busy')).toBe('true')
    expect(open).toHaveBeenCalledTimes(1)
    d.resolve({ terminalId: 'launch-a:shell' })
    await flush()
    expect(btn?.hasAttribute('aria-busy')).toBe(false)
  })

  it('a pane belongs to ITS terminal: switching to another card shows no pane there', async () => {
    stubShell(() => Promise.resolve({ terminalId: 'launch-a:shell' }))
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().addCorrelation('b', 'launch-b')
    boardStore.getState().switchTerminal('launch-a')
    const r = render()
    act(() =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="focused-shell"]')?.click()
    )
    await flush()
    act(() => boardStore.getState().switchTerminal('launch-b'))
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-shell"]')
    expect(btn?.hasAttribute('data-lit')).toBe(false)
    expect(
      r.container.querySelector('[data-terminal-id="launch-b"] [data-testid="shell-pane"]')
    ).toBeNull()
    // a's pane is still there, hidden with a's whole frame (the kept-alive rule)
    expect(
      r.container.querySelector('[data-terminal-id="launch-a"] [data-testid="shell-pane"]')
    ).not.toBeNull()
  })
  it('prunes a pane once its parent frame is no longer rendered, and keeps it while claude is merely dead', async () => {
    stubShell(() => Promise.resolve({ terminalId: 'launch-a:shell' }))
    boardStore.getState().openLaunchedTerminal('launch-a', 'a', 'default')
    const r = render()
    act(() =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="focused-shell"]')?.click()
    )
    await flush()
    // claude exits: App forgets the registry entry, but the terminal is still FOCUSED → still rendered.
    act(() => boardStore.getState().forgetLaunchedTerminal('launch-a'))
    expect(selectShellPane(boardStore.getState(), 'launch-a')).not.toBeNull()
    // focus leaves it (a switch away): the frame unmounts → the pane is pruned.
    act(() => boardStore.setState({ focusedTerminalId: null }))
    expect(selectShellPane(boardStore.getState(), 'launch-a')).toBeNull()
  })
})
