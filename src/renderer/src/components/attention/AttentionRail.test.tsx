// Story 3.4 (FR-16) — AttentionRail component tests (AC-1, AC-2, AC-5). jsdom `unit` project.
//
// Drives the rail against the singleton boardStore (reset per case). Asserts: always-present +
// collapsible to icons (never hidden); rows = status dot + short name from the SAME source as the
// board; needs-you emphasis applied (the SHIPPED needsYouEmphasisClass) and CLEARED on acknowledge;
// keyboard activation (Enter/Space) = click; aria-live announces a NEW needs-you; click invokes
// onActivateSession with the sessionId; narrow per-row subscription.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { AttentionRail } from './AttentionRail'
import { shortName } from './railName'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import { boardStore } from '../../stores/boardStore'
import type { Column, WatchEventsPayload } from '../../../../shared/ipc/contract'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** A2 — render with the rename seam wired (the pencil only exists when `onRenameSession` is). */
function renderWithRename(
  onRenameSession: (id: string) => void,
  onActivateSession: (id: string) => void = () => {}
): RenderResult {
  const r = renderComponent(
    <AttentionRail onActivateSession={onActivateSession} onRenameSession={onRenameSession} />
  )
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

  // REGRESSION PIN: an expanded row rendered the session name TWICE — the dot was given
  // `label={name}` with `labelHidden={collapsed}`, so whenever the rail was expanded the dot
  // printed the name as its own VISIBLE label, and `.name` printed it again. The pre-existing
  // test above could not catch it: it only asserts a `status-label` NODE exists, which is true
  // either way. Assert on the row's rendered TEXT, so re-adding `label={name}` turns this red.
  it('renders the session name exactly ONCE in an expanded row (no duplicate title)', () => {
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'needs-you', 100, { sessionName: 'deploy-prod' }))
    )
    const r = render()
    const row = r.container.querySelector('[data-session-id="a"]')
    const occurrences = (row?.textContent ?? '').split('deploy-prod').length - 1
    expect(occurrences).toBe(1)
    // The dot's label contributes the STATUS, never a second copy of the title.
    expect(row?.querySelector('[data-testid="status-label"]')?.textContent).toBe('Needs you')
  })

  // The status must survive non-visually. The row is a <button aria-label=…>, and an aria-label
  // REPLACES the element's inner text for assistive tech — so the dot's sr-only status span is
  // never announced from inside it. The status therefore has to be in the row's own label, or it
  // reaches a screen-reader user through dot colour alone.
  it("the row's accessible name carries the status text, not just the session name", () => {
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'needs-you', 100, { sessionName: 'deploy-prod' }))
    )
    const r = render()
    const row = r.container.querySelector('[data-session-id="a"]')
    const label = row?.getAttribute('aria-label') ?? ''
    expect(label).toContain('deploy-prod')
    expect(label).toContain('Needs you')
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
    // Goal B: the circle ALONE. The row used to also print the name's first letter beside the dot
    // ("● D"). The only text left in a collapsed row is the dot's screen-reader-only status label,
    // so pin the text EXACTLY — re-adding an initial glyph makes this red.
    const row = r.container.querySelector('[data-testid="rail-row"]')
    expect(row?.textContent).toBe('Needs you')
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

describe('AttentionRail — pinned active row + status sections', () => {
  /** Bind a session to a terminal and put that terminal on screen — i.e. make it the active one. */
  function focusSession(sessionId: string, terminalId: string): void {
    act(() => {
      boardStore.getState().addCorrelation(sessionId, terminalId)
      boardStore.getState().switchTerminal(terminalId)
    })
  }

  function rowOrder(r: RenderResult): (string | null)[] {
    return [...r.container.querySelectorAll('[data-testid="rail-row"]')].map((el) =>
      el.getAttribute('data-session-id')
    )
  }

  function dividerLabels(r: RenderResult): (string | null)[] {
    return [...r.container.querySelectorAll('[data-testid="rail-divider"]')].map((el) =>
      el.getAttribute('data-label')
    )
  }

  // THE ASK: the terminal you are looking at must not slide down the rail the moment some other
  // session goes needs-you. 'open' here is IDLE and would have sorted DEAD LAST under the old
  // needs-you-first flat order — so if the pin regresses, this goes red rather than passing by
  // luck of the sort.
  it('the ACTIVE session is first even when needs-you sessions exist', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'open', 'idle', 500))
      boardStore.getState().applyWatchEvent(updated(1, 'wants-you', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'busy', 'working', 200))
    })
    focusSession('open', 'tid-open')
    const r = render()
    expect(rowOrder(r)[0]).toBe('open')
    expect(r.container.querySelector('[data-session-id="open"]')?.getAttribute('data-active')).toBe(
      'true'
    )
  })

  // A nav list that shows the same session twice reads as two sessions. The pinned row is filtered
  // out of its own group by `selectRailSection`.
  it('the ACTIVE session appears exactly once (pinned, NOT repeated in its status group)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'open', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'other', 'needs-you', 200))
    })
    focusSession('open', 'tid-open')
    const r = render()
    expect(rowOrder(r).filter((id) => id === 'open').length).toBe(1)
    // ...and the group it left still lists the sessions that are actually in it.
    const needsList = r.container.querySelector(
      '[data-testid="rail-section"][data-column="needs-you"]'
    )
    expect(
      [...(needsList?.querySelectorAll('[data-testid="rail-row"]') ?? [])].map((el) =>
        el.getAttribute('data-session-id')
      )
    ).toEqual(['other'])
  })

  // "no need to advertise it is the current" — the pinned row's own fill + "(active)" in its
  // accessible name already say what it is, and a rule above it would push it into the list it is
  // deliberately standing outside of.
  it('the pinned row has NO divider above it — the first divider belongs to the first group', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'open', 'idle', 500))
      boardStore.getState().applyWatchEvent(updated(1, 'wants-you', 'needs-you', 100))
    })
    focusSession('open', 'tid-open')
    const r = render()
    const scroll = r.container.querySelector('[data-testid="rail-scroll"]')
    // The pinned list is the FIRST child of the scroll container; nothing precedes it.
    expect(scroll?.firstElementChild?.getAttribute('data-testid')).toBe('rail-pinned-list')
    expect(dividerLabels(r)).toEqual(['Needs you'])
  })

  it('groups are dividered Needs you → Working → Idle → Starting, in that order', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'i', 'idle', 300))
      boardStore.getState().applyWatchEvent(updated(1, 'n', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 200))
      boardStore.getState().openLaunchedTerminal('tid-new', 'fresh')
    })
    const r = render()
    expect(dividerLabels(r)).toEqual(['Needs you', 'Working', 'Idle', 'Starting'])
    expect(rowOrder(r)).toEqual(['n', 'w', 'i'])
  })

  // Three empty rules over a rail holding one session is furniture, not content.
  it('an EMPTY status group renders no divider and no list', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 200)))
    const r = render()
    expect(dividerLabels(r)).toEqual(['Working'])
    expect(r.container.querySelector('[data-testid="rail-section"][data-column="idle"]')).toBeNull()
    expect(
      r.container.querySelector('[data-testid="rail-section"][data-column="needs-you"]')
    ).toBeNull()
  })

  it('within a group, the longest-waiting session is first (oldest enteredColumnAt)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'new-needs', 'needs-you', 300))
      boardStore.getState().applyWatchEvent(updated(1, 'old-needs', 'needs-you', 100))
    })
    const r = render()
    expect(rowOrder(r)).toEqual(['old-needs', 'new-needs'])
  })

  // The divider is decoration (aria-hidden); the grouping reaches assistive tech through the
  // sibling list's accessible name. Without this, a screen-reader user gets four unlabelled lists.
  it('each group list carries the status as its accessible name; the divider is aria-hidden', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'n', 'needs-you', 100)))
    const r = render()
    const list = r.container.querySelector('[data-testid="rail-list"]')
    expect(list?.getAttribute('aria-label')).toBe('Needs you')
    expect(
      r.container.querySelector('[data-testid="rail-divider"]')?.getAttribute('aria-hidden')
    ).toBe('true')
  })

  // NON-VACUITY: pin the exclusion itself. Dropping the `s.id !== activeId` filter in
  // `selectRailSection` would render 'open' twice and turn the once-only test above red; dropping
  // the pinned block would drop it to the bottom of the IDLE group and turn the first test red.
  it('NON-VACUITY: with NO focused terminal there is no pinned list and every session is in a group', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'a', 'idle', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 200))
    })
    const r = render()
    expect(r.container.querySelector('[data-testid="rail-pinned-list"]')).toBeNull()
    expect(rowOrder(r)).toEqual(['b', 'a'])
  })

  // A just-launched terminal has no session card yet, so nothing can be pinned. The rail must not
  // guess — it leaves the pin empty and the Starting row carries the active marker instead.
  it('a focused-but-uncorrelated launch pins nothing; the starting row is marked active', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-fresh', 'fresh'))
    const r = render()
    expect(r.container.querySelector('[data-testid="rail-pinned-list"]')).toBeNull()
    expect(
      r.container.querySelector('[data-terminal-id="tid-fresh"]')?.getAttribute('data-active')
    ).toBe('true')
  })
})

// The active row is the session already on screen, so "switch to it" is not an action. It stops
// being a control entirely: no click, no hover change, no tab stop. The rename pencil beside it
// stays a real button — it is the one thing on that row that still does something.
describe('AttentionRail — the active row is NOT a control', () => {
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  function focusSession(sessionId: string, terminalId: string): void {
    act(() => {
      boardStore.getState().addCorrelation(sessionId, terminalId)
      boardStore.getState().switchTerminal(terminalId)
    })
  }

  it('the active row is not a <button> and clicking it does not activate anything', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    focusSession('a', 'tid-a')
    const onActivate = vi.fn()
    const r = render(onActivate)
    const row = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(row?.tagName).not.toBe('BUTTON')
    act(() => row?.click())
    expect(onActivate).not.toHaveBeenCalled()
  })

  // Not a button and no tabIndex ⇒ it is out of the tab order. A focusable element that does
  // nothing when activated is a dead stop for a keyboard user.
  it('the active row is out of the tab order', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    focusSession('a', 'tid-a')
    const r = render()
    const row = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(row?.getAttribute('tabindex')).toBeNull()
    expect(row?.tagName).not.toBe('BUTTON')
  })

  // A generic <div> does not reliably expose `aria-label`, so the active row's name and status
  // must be real content. Collapsed hides the name visually — it has to survive as sr-only text,
  // or the row announces a status with no session attached to it.
  it('the active row announces name + status as content, collapsed included', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100)))
    focusSession('a', 'tid-a')
    const r = render()
    const expanded = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(expanded?.getAttribute('aria-current')).toBe('true')
    expect(expanded?.textContent).toContain('Needs you')
    expect(expanded?.textContent).toContain(shortName(boardStore.getState().sessionsById['a']!))

    const toggle = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')
    act(() => toggle?.click())
    const collapsed = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    // The name is gone VISUALLY (no .name span) but still readable non-visually.
    expect(collapsed?.querySelector('[data-testid="rail-row-name"]')).toBeNull()
    expect(collapsed?.textContent).toContain(shortName(boardStore.getState().sessionsById['a']!))
  })

  it('the rename pencil still works on the active row, and is still a sibling not a child', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    focusSession('a', 'tid-a')
    const onRename = vi.fn()
    const r = renderWithRename(onRename)
    const row = r.container.querySelector('[data-testid="rail-row"]')
    const pencil = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-rename"]')
    expect(pencil?.tagName).toBe('BUTTON')
    expect(row?.contains(pencil as Node)).toBe(false) // button-in-button would be invalid HTML
    act(() => pencil?.click())
    expect(onRename).toHaveBeenCalledWith('a')
  })

  // NON-VACUITY: the OTHER rows must keep working. If the div branch ever swallowed every row,
  // the rail would become a read-only list and every test above would still pass.
  it('NON-VACUITY: a non-active row is still a <button> and still activates', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'b', 'working', 200))
    })
    focusSession('a', 'tid-a')
    const onActivate = vi.fn()
    const r = render(onActivate)
    const other = r.container.querySelector<HTMLButtonElement>('[data-session-id="b"]')
    expect(other?.tagName).toBe('BUTTON')
    act(() => other?.click())
    expect(onActivate).toHaveBeenCalledWith('b')
  })

  // jsdom does no layout and never applies :hover, so the only way to pin this is to read the
  // stylesheet. Without the `:not(.active)`, the active row lights up under the pointer —
  // feedback promising a press that does nothing.
  it('the hover background rule EXCLUDES the active row', () => {
    const css = readCss('./AttentionRail.module.css')
    expect(css).toMatch(/\.row:not\(\.active\):hover\s*\{/)
    // ...and the unscoped form is gone, or it would re-apply to everything.
    expect(css).not.toMatch(/^\.row:hover\s*\{/m)
  })

  it('the active row does not show a pointer cursor', () => {
    const css = readCss('./AttentionRail.module.css')
    expect(css).toMatch(/\.row\.active\s*\{[^}]*cursor:\s*default/s)
  })

  // The fill scheme is INVERTED: resting rows are the RAISED tone and the active row drops all the
  // way to the TERMINAL surface, with hover previewing that fill. jsdom applies no :hover and
  // computes no colour, so the wiring is pinned by reading the stylesheet; the DIRECTION (terminal
  // darker than rest) is pinned on the token values in styles/tokens.test.ts.
  it('resting rows take the rest fill; hover and active take the SAME terminal fill', () => {
    const css = readCss('./AttentionRail.module.css')
    expect(css).toMatch(/\.row\s*\{[^}]*background:\s*var\(--bg-row-rest\)/s)
    expect(css).toMatch(/\.row:not\(\.active\):hover\s*\{[^}]*background:\s*var\(--bg-terminal\)/s)
    expect(css).toMatch(/^\.active\s*\{[^}]*background:\s*var\(--bg-terminal\)/ms)
    // A not-yet-correlated launch is still a row in the same rail: same rest fill, same hover.
    expect(css).toMatch(/\.startingRow\s*\{[^}]*background:\s*var\(--bg-row-rest\)/s)
    expect(css).toMatch(/\.startingRow:hover\s*\{[^}]*background:\s*var\(--bg-terminal\)/s)
  })

  // The active row is a TAB cut into the rail's right edge, not a chip: right corners squared, and
  // widened by exactly the list's own right padding so it ends flush at the rail's content edge.
  // Both halves matter — a squared chip that still floats inside the padding points at nothing, and
  // a flush chip with four round corners has no direction. Pinned on BOTH row kinds because
  // `.startingRow` is defined after `.active` and would otherwise win on source order.
  it('the active row is squared and widened to the rail edge — in BOTH row kinds', () => {
    const css = readCss('./AttentionRail.module.css')
    // Both anchored to LINE START: unanchored, `.startingRow.active` also matches inside the
    // `.collapsed .startingRow.active` reset above it, and the test would read that block instead.
    for (const sel of [/^\.active\s*\{([^}]*)/m, /^\.startingRow\.active\s*\{([^}]*)/m]) {
      const block = sel.exec(css)?.[1] ?? ''
      expect(block).toMatch(/width:\s*calc\(100% \+ var\(--space-2\)\)/)
      expect(block).toMatch(/border-radius:\s*var\(--rounded-md\) 0 0 var\(--rounded-md\)/)
    }
    // `.rowWrap` is `display: flex`, so the row is a FLEX ITEM and the default `flex-shrink: 1`
    // silently undoes the width above — the row rendered 8px short of the rail edge, still
    // floating. The width and the shrink guard are ONE fix; neither is meaningful alone.
    expect(/^\.active\s*\{([^}]*)/m.exec(css)?.[1] ?? '').toMatch(/flex-shrink:\s*0/)
    // ...and the tab is EXPANDED-only: a collapsed row is a centred square, so the squared corners
    // are reset there. Without this the collapsed rail shows a square pointing at a gutter.
    expect(css).toMatch(
      /\.collapsed \.row\.active,\s*\.collapsed \.startingRow\.active\s*\{[^}]*border-radius:\s*var\(--rounded-md\)\s*;/s
    )
  })

  // TWO ROW SIZES, ONE SMALL STEP: rows are 40px and the ACTIVE row alone is 44px. The values are
  // read out of the sheet rather than hardcoded, so retuning the step is a one-line CSS change and
  // this test follows it; what is pinned is the SHAPE of the rule, not the numbers.
  //
  // The load-bearing half is the last assertion. Needs-you used to enlarge 44->56px, and a size
  // driven by SESSION STATE reflows rows under the operator as sessions they are not watching
  // change status. The active row is different in kind — it changes only when the operator switches
  // session — so it is the one state allowed to spend size. Sweeping EVERY row rule (rather than
  // naming `.emphasized`) is what makes that hold for a state nobody has written yet.
  it('rows come in exactly two sizes, one small step apart, and only .active takes the larger', () => {
    const css = readCss('./AttentionRail.module.css')

    // A ROW rule is one whose selector names a row class. The lookahead keeps `.rowWrap`,
    // `.rowRenameButton` and `.startingRowName` out — chrome around a row, not the row, and they
    // legitimately carry their own sizes (a 20px pencil, a 24px chevron).
    const ROW_CLASS = /\.(?:row|startingRow|emphasized|active)(?![A-Za-z])/
    const rules: { selector: string; sizes: number[] }[] = []
    for (const [, rawSelector, block] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = (rawSelector ?? '').trim()
      if (!ROW_CLASS.test(selector)) continue
      const sizes = [...(block ?? '').matchAll(/^\s*(?:min-)?(?:width|height):\s*(\d+)px/gm)].map(
        (m) => Number(m[1])
      )
      if (sizes.length > 0) rules.push({ selector, sizes })
    }
    expect(rules.length).toBeGreaterThan(0) // non-vacuity: the sweep found row rules at all

    const all = [...new Set(rules.flatMap((r) => r.sizes))].sort((a, b) => a - b)
    expect(all).toHaveLength(2)
    const [resting, active] = all as [number, number]
    expect(active).toBeGreaterThan(resting)
    // "A tiny bit" — a step, not an enlarge. 56px (the old needs-you size) would fail this.
    expect(active - resting).toBeLessThanOrEqual(6)

    // The EXPANDED step specifically. Without this the sweep stays green when the expanded step is
    // flattened but the collapsed square keeps the larger value — the set is still {40, 44} and the
    // only rule using 44 is still an `.active` rule. (Found by fault injection, not by review.)
    expect(/^\.active\s*\{([^}]*)/m.exec(css)?.[1] ?? '').toMatch(
      new RegExp(`min-height:\\s*${active}px`)
    )

    // Every rule that spends the larger size must be an ACTIVE rule. This is the needs-you guard.
    for (const rule of rules) {
      if (!rule.sizes.includes(active)) continue
      expect(rule.selector, `${rule.selector} uses the active-only size`).toMatch(
        /\.active(?![A-Za-z])/
      )
    }
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

  // Goal B: a collapsed rail is a column of CIRCLES — no initial letters. A normal RailRow gets
  // that for free (its StatusDot is the circle), but this row has no status dot by design, so it
  // renders a neutral hollow RING instead. It must render NO text: the letter is what Goal B
  // removed, and dropping it without a glyph would leave an empty button.
  it('in collapsed mode, starting row renders a neutral ring and NO text (no initial letter)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-coll', 'delta'))
    const r = render()
    const toggle = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')
    act(() => toggle?.click())
    const row = r.container.querySelector('[data-terminal-id="tid-coll"]')
    expect(row).not.toBeNull()
    expect(row?.querySelector('[data-testid="starting-rail-glyph"]')).not.toBeNull()
    // No glyph text at all — not the initial, not the name, not the sublabel.
    expect(row?.textContent).toBe('')
    // ...but the row is still identifiable non-visually and on hover.
    //
    // "(active)" is here because `openLaunchedTerminal` FOCUSES the terminal it registers, so this
    // row is the one on screen. The rail's pinned slot holds the active SESSION, and a starting
    // terminal has no session card yet — so during the launch→correlate window this row is the
    // only place the active marker can live. Without it, launching a session leaves the rail with
    // no active marker at all. Same wording shape as a RailRow's "(active)" suffix.
    expect(row?.getAttribute('aria-label')).toBe('delta — starting (active)')
    expect(row?.getAttribute('title')).toBe('delta — starting (active)')
    expect(row?.getAttribute('data-active')).toBe('true')
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

// ── A2 rename from the rail ───────────────────────────────────────────────────
describe('AttentionRail — rename affordance (session-naming A2)', () => {
  it('renders NO pencil when onRenameSession is omitted', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    const r = render()
    expect(r.container.querySelector('[data-testid="rail-rename"]')).toBeNull()
  })

  it("renders a pencil per row when wired, and fires it with that row's session id", () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    const onRename = vi.fn()
    const r = renderWithRename(onRename)
    const pencil = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-rename"]')
    expect(pencil).not.toBeNull()
    fireEvent(pencil as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a')
  })

  // The pencil must NOT be inside the row: the row is a real <button>, and nesting a button in a
  // button is invalid HTML (the browser un-nests it, which silently breaks the click target).
  // SessionCard can nest one because its root is a div[role=button]; this cannot.
  it('the pencil is a SIBLING of the row button, never nested inside it (valid HTML)', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    const r = renderWithRename(vi.fn())
    const row = r.container.querySelector('[data-testid="rail-row"]')
    const pencil = r.container.querySelector('[data-testid="rail-rename"]')
    expect(row).not.toBeNull()
    expect(pencil).not.toBeNull()
    expect(row?.contains(pencil as Node)).toBe(false)
    expect(pencil?.tagName).toBe('BUTTON')
  })

  it('clicking the pencil does NOT activate the row (they are separate controls)', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    const onActivate = vi.fn()
    const onRename = vi.fn()
    const r = renderWithRename(onRename, onActivate)
    fireEvent(
      r.container.querySelector('[data-testid="rail-rename"]') as HTMLButtonElement,
      new MouseEvent('click', { bubbles: true })
    )
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  // Collapsed is 56px wide and its <li> shrink-wraps the circle; a second control there would push
  // the circle back off-centre (undoing the measured centring fix). Rename stays available from the
  // board card in that mode.
  it('renders NO pencil in COLLAPSED mode (no room; would de-centre the circle)', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'a', 'working', 100)))
    const r = renderWithRename(vi.fn())
    expect(r.container.querySelector('[data-testid="rail-rename"]')).not.toBeNull()
    const toggle = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')
    act(() => toggle?.click())
    expect(r.container.querySelector('[data-testid="rail-rename"]')).toBeNull()
    // ...and the row itself is still there (never hidden — UX-DR9).
    expect(r.container.querySelector('[data-testid="rail-row"]')).not.toBeNull()
  })

  it('the pencil has an accessible name naming the session', () => {
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'working', 100, { sessionName: 'deploy-prod' }))
    )
    const r = renderWithRename(vi.fn())
    expect(
      r.container.querySelector('[data-testid="rail-rename"]')?.getAttribute('aria-label')
    ).toBe('Rename deploy-prod')
  })
})

// COLLAPSED GEOMETRY — the rail must be wide enough to actually SEAT its square, not just wide
// enough to clip it.
//
// The regression this pins (observed 2026-08-25): `--rail-width-collapsed` was 56px and the widest
// row square was also 56px, but the rail carries a 1px right border — so the content box was 55px,
// the square hung half a pixel past each side, and `overflow-x: hidden` shaved its border off. On
// screen: a square missing its right edge. The arithmetic is the whole bug, so the arithmetic is
// what gets asserted; jsdom does no layout, and a value-free "it renders" test would have stayed
// green through it.
//
// Rows are all one size now, so there is a single square to seat — but the rail keeps its slack on
// purpose. Sizing the rail to exactly fit its widest row is what broke it the first time.
describe('collapsed rail geometry (the clipped-square regression)', () => {
  const px = (s: string | undefined): number => Number((s ?? '').replace('px', ''))

  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  /** The rail's own right border, which eats into the content box. */
  const RAIL_BORDER_PX = 1

  /** Widest square any `.collapsed` row rule declares — the one that gets clipped if the rail is
   *  sized to exactly fit. Swept rather than named so a new widest state cannot slip past. */
  const widestCollapsedSquare = (rail: string): number =>
    Math.max(
      ...[...rail.matchAll(/\.collapsed [^{}]*\{([^}]*)\}/g)].flatMap((m) =>
        [...(m[1] ?? '').matchAll(/^\s*width:\s*(\d+)px/gm)].map((w) => Number(w[1]))
      )
    )

  it('seats the row square with room to spare on both sides', () => {
    const tokens = readCss('../../styles/tokens.css')
    const rail = readCss('./AttentionRail.module.css')

    const collapsedWidth = px(/--rail-width-collapsed:\s*([\d.]+px)/.exec(tokens)?.[1])
    // The WIDEST collapsed square, whichever rule declares it — not a named selector. The active
    // row is currently the widest; hardcoding `.collapsed .row` here would stop watching the one
    // that actually risks being clipped the moment those two swap.
    const squareWidth = widestCollapsedSquare(rail)

    expect(collapsedWidth).toBeGreaterThan(0)
    expect(squareWidth).toBeGreaterThan(0)

    const contentBox = collapsedWidth - RAIL_BORDER_PX
    // Strictly greater, not >=: equal would mean the square touches both edges with its border
    // flush against the clip boundary — which is how this broke the first time.
    expect(contentBox).toBeGreaterThan(squareWidth)
  })

  it('leaves a real gutter, not a single spare pixel', () => {
    const tokens = readCss('../../styles/tokens.css')
    const rail = readCss('./AttentionRail.module.css')

    const collapsedWidth = px(/--rail-width-collapsed:\s*([\d.]+px)/.exec(tokens)?.[1])
    // The WIDEST collapsed square, whichever rule declares it — not a named selector. The active
    // row is currently the widest; hardcoding `.collapsed .row` here would stop watching the one
    // that actually risks being clipped the moment those two swap.
    const squareWidth = widestCollapsedSquare(rail)
    const gutter = (collapsedWidth - RAIL_BORDER_PX - squareWidth) / 2

    expect(gutter).toBeGreaterThanOrEqual(4)
  })
})
