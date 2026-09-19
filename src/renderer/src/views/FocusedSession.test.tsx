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
import { boardStore } from '../stores/boardStore'
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
    launchedTerminals: {}
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
// Story 4.3 (FR-15) — the ⏹ Stop session header button tests
// ---------------------------------------------------------------------------

describe('FocusedSession — Story 4.3 ⏹ Stop session header button (FR-15)', () => {
  it('renders the ⏹ Stop session button in the focused header', () => {
    boardStore.getState().openLaunchedTerminal('launch-stop-test', 'stop-test', 'default')
    const r = render()
    const stopBtn = r.container.querySelector('[data-testid="focused-stop"]')
    expect(stopBtn).not.toBeNull()
  })

  it('clicking ⏹ Stop session opens the Stop-confirm with the focused terminalId', () => {
    boardStore.getState().openLaunchedTerminal('launch-stop-click', 'stop-click', 'default')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    expect(stopBtn).not.toBeNull()

    stopBtn?.click()

    // The Stop-confirm should be open with the correct terminalId.
    expect(boardStore.getState().stopConfirm).not.toBeNull()
    expect(boardStore.getState().stopConfirm?.terminalId).toBe('launch-stop-click')
  })

  it('clicking ⏹ Stop session includes a sessionName in the payload (verbatim name or terminalId fallback)', () => {
    // When correlated, the sessionName should be the c9watch name.
    boardStore.getState().applyWatchEvent(updated(1, 'sess-corr', 'working', 100))
    boardStore.getState().addCorrelation('sess-corr', 'launch-corr-term')
    boardStore.getState().switchTerminal('launch-corr-term')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    stopBtn?.click()

    const payload = boardStore.getState().stopConfirm
    expect(payload).not.toBeNull()
    expect(payload?.terminalId).toBe('launch-corr-term')
    // The session name should be the c9watch name (s-sess-corr from the `updated` helper).
    expect(payload?.sessionName).toBe('s-sess-corr')
  })

  it('clicking ⏹ Stop session degrades gracefully to terminalId when no correlation exists', () => {
    // Pre-correlation: no session bound to this terminal yet → fall back to bare terminalId.
    boardStore.getState().openLaunchedTerminal('launch-pre-corr', 'pre-corr', 'default')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    stopBtn?.click()

    const payload = boardStore.getState().stopConfirm
    expect(payload).not.toBeNull()
    // No session correlated → sessionName falls back to bare terminalId (never crashes).
    expect(payload?.sessionName).toBe('launch-pre-corr')
  })

  it('the ⏹ Stop session button is rendered and focusedTerminalId is wired to the payload', () => {
    // The null-guard in handleStopSession is internal; verify the button correctly passes
    // the focused terminalId from the store into the payload (not a hardcoded value).
    boardStore.getState().openLaunchedTerminal('launch-id-wire-check', 'id-wire-check', 'default')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    expect(stopBtn).not.toBeNull()
    stopBtn?.click()
    // The payload terminalId must match the store's focusedTerminalId exactly.
    expect(boardStore.getState().stopConfirm?.terminalId).toBe(
      boardStore.getState().focusedTerminalId ?? 'launch-id-wire-check'
    )
  })
})

// ---------------------------------------------------------------------------
// Spec: terminal-input-breathing-room — reserved bottom tool strip (2026-06-24)
// ---------------------------------------------------------------------------

describe('FocusedSession — reserved bottom tool strip (breathing room spec)', () => {
  it('renders a .toolStrip sibling AFTER .terminalWrap inside .main (aria-hidden)', () => {
    boardStore.getState().openLaunchedTerminal('launch-strip-test', 'strip-test', 'default')
    const r = render()

    // Locate .main by finding the focused-session root and then its second child
    // (index 1 = .main; index 0 = the attention rail).
    const focused = r.container.querySelector('[data-testid="focused-session"]')
    expect(focused).not.toBeNull()

    // .main is the second child of the focused wrapper (after AttentionRail).
    const main = focused?.children[1] as HTMLElement | undefined
    expect(main).not.toBeUndefined()

    // Find .terminalWrap and .toolStrip among .main's direct children.
    const children = main !== undefined ? [...main.children] : []
    const terminalWrapIndex = children.findIndex((el) => el.className.includes('terminalWrap'))
    const toolStripIndex = children.findIndex((el) => el.className.includes('toolStrip'))

    // Both must be present.
    expect(terminalWrapIndex).toBeGreaterThanOrEqual(0)
    expect(toolStripIndex).toBeGreaterThanOrEqual(0)

    // .toolStrip must come AFTER .terminalWrap (sibling, not child).
    expect(toolStripIndex).toBeGreaterThan(terminalWrapIndex)

    // The strip carries aria-hidden="true".
    const toolStrip = children[toolStripIndex]
    expect(toolStrip?.getAttribute('aria-hidden')).toBe('true')
  })

  it('the tool strip is NOT inside .terminalWrap (must stay out of the terminal stacking context)', () => {
    boardStore
      .getState()
      .openLaunchedTerminal('launch-strip-placement', 'strip-placement', 'default')
    const r = render()

    const focused = r.container.querySelector('[data-testid="focused-session"]')
    const main = focused?.children[1] as HTMLElement | undefined
    const terminalWrap =
      main !== undefined
        ? [...main.children].find((el) => el.className.includes('terminalWrap'))
        : undefined

    expect(terminalWrap).not.toBeUndefined()

    // The .toolStrip div must NOT be a descendant of .terminalWrap.
    // (Query by CSS module class substring — it is NOT a child of the wrap.)
    const stripInsideWrap =
      terminalWrap !== undefined
        ? [...terminalWrap.querySelectorAll('*')].find((el) => el.className.includes('toolStrip'))
        : undefined
    expect(stripInsideWrap).toBeUndefined()
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

// The active tab is a NOTCH cut through the rail, showing the ground the terminal floats on. Two
// separate declarations in two different modules make that work, and each looks individually
// tidy-uppable — which is how a notch quietly gets a wall built back across it.
describe('FocusedSession — the wall stops at the active tab', () => {
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  const block = (css: string, selector: RegExp): string => selector.exec(css)?.[1] ?? ''

  it('the rail draws a wall, and the tab is wide enough to break it', () => {
    const rail = readCss('../components/attention/AttentionRail.module.css')
    const railBlock = block(rail, /^\.rail\s*\{([^}]*)/m)
    const active = block(rail, /^\.active\s*\{([^}]*)/m)

    // The wall exists...
    expect(railBlock).toMatch(/^\s*border-right:\s*1px solid var\(--border\)/m)
    // ...and the rail must not clip, or the tab can never reach the pixel the wall occupies:
    // `overflow: hidden` clips descendants to the PADDING box, which stops short of the border.
    expect(railBlock).toMatch(/^\s*overflow:\s*visible/m)
    // The tab carries no right border of its own — it stays open toward the terminal...
    expect(active).toMatch(/border-right-width:\s*0/)
    // ...and is widened by the list padding PLUS the wall's 1px, which is what breaks the line.
    expect(active).toMatch(/width:\s*calc\(100% \+ var\(--space-2\) \+ 1px\)/)
    // Right corners SQUARE — the curve there flares OUTWARD and is painted by the flares below.
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
    // drawn — but by exactly ONE side. The rail's `border-right` runs the full height and already
    // covers this strip. A `border-left` on the bar does not overlap it: the rail's line is the last
    // pixel INSIDE its `--rail-width` box, the bar's the first pixel outside, so the two stack into
    // a 2px seam across the top strip that thins to 1px below the bar. The bar legitimately carried
    // this border while the rail had no wall; the wall's return turned it into a duplicate, and the
    // widening is most visible exactly where the eye crosses from the rail into the terminal.
    const railBlock = block(
      readCss('../components/attention/AttentionRail.module.css'),
      /^\.rail\s*\{([^}]*)/m
    )
    expect(railBlock).toMatch(/^\s*border-right:\s*1px solid var\(--border\)/m)

    // Declaration form, not a bare substring — the bar's own comment explains why it has no
    // border-left, and a naive /border-left/ would match that prose and pass on a real regression.
    const barBlock = block(readCss('./FocusedSession.module.css'), /^\.bar\s*\{([^}]*)/m)
    expect(barBlock).not.toMatch(/^\s*border-left\s*:/m)
  })
})

// The tab's SHOULDERS: where its top and bottom borders sweep away from the row and turn into the
// rail's wall, the way a browser tab meets its toolbar. This is a CONCAVE corner — the tab's
// surface bulging outward while the rail curves in to meet it — and `border-radius` cannot draw
// one: a radius bites into a box, it does not bulge out of it. So each shoulder is painted, by a
// radial gradient on a pseudo-element parked just outside the corner.
//
// Nothing about that is guessable from the declarations alone, which is exactly why it needs a
// test: the obvious "simplification" is to delete the pseudo-elements and put a radius on the
// right-hand corners, which silently turns the flare inward.
describe('FocusedSession — the active tab flares outward into the wall', () => {
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  const rail = (): string => readCss('../components/attention/AttentionRail.module.css')

  it('paints both shoulders as gradient arcs, not as corner radii', () => {
    const css = rail()
    const shared = /\.active::before,\s*\.active::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    // Parked outside the tab's right edge, and decorative only — the row's hit area must not grow.
    expect(shared).toMatch(/position:\s*absolute/)
    expect(shared).toMatch(/right:\s*0/)
    expect(shared).toMatch(/pointer-events:\s*none/)

    // Selectors matched EXACTLY. A loose `/\.active::after\s*\{/` also matches the shared rule
    // above, whose second selector line begins with the same text — and then reads the wrong body.
    const ruleFor = (selector: string): string => {
      for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if ((sel ?? '').trim() === selector) return body ?? ''
      }
      return ''
    }
    for (const selector of ['.active::before', '.active::after']) {
      const block = ruleFor(selector)
      expect(block, `${selector} must exist as its own rule`).not.toBe('')
      expect(block).toMatch(/radial-gradient/)
      // Three bands, in this order: the rail continuing over the flare, the 1px arc, then the
      // tab's own surface flared out to the wall. Get the order wrong and the curve inverts.
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
      /\.collapsed \.active::before,\s*\.collapsed \.active::after\s*\{[^}]*content:\s*none/s
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
