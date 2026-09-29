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
import { AttentionRail, type AttentionRailProps } from './AttentionRail'
import { shortName } from './railName'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import { boardStore } from '../../stores/boardStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { tagsStore } from '../../stores/tagsStore'
import type { Column, Tag, WatchEventsPayload } from '../../../../shared/ipc/contract'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let cleanup: (() => void) | undefined

function updated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number,
  over: Partial<{
    sessionName: string
    projectPath: string
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
      status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
      column,
      enteredColumnAt,
      pid: 1000,
      workspaceId: over.workspaceId ?? 'default',
      tagIds: over.tagIds ?? []
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
    launchedTerminals: {},
    searchQuery: ''
  })
  // Workspaces (Task 9a fix, review round 1) — reset the active workspace so a test that
  // switches it does not bleed into a later test in this file.
  workspacesStore.setState({ activeId: 'default' })
  // Tags (Task 12) — reset the catalog + filter so a test that hydrates tags does not bleed
  // into a later test in this file.
  tagsStore.setState({ tags: [], loaded: false, activeTagId: null })
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

  // The board's search box narrows the rail's groups like the tag filter does. The pinned row is the
  // terminal you are typing in, so it stays whatever the search says.
  it('the search narrows the status groups, never the pinned row', () => {
    act(() => {
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'open', 'idle', 500, { sessionName: 'Review' }))
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'dep', 'needs-you', 100, { sessionName: 'Deploy' }))
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'rev2', 'needs-you', 200, { sessionName: 'Review two' }))
    })
    focusSession('open', 'tid-open')
    const r = render()
    expect(rowOrder(r)).toEqual(['open', 'dep', 'rev2'])
    act(() => boardStore.getState().setSearchQuery('deploy'))
    expect(rowOrder(r)).toEqual(['open', 'dep'])
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
    const slot = r.container.querySelector('[data-testid="rail-pinned-slot"]')
    const scroll = r.container.querySelector('[data-testid="rail-scroll"]')
    // The slot sits OUTSIDE the scroll container and immediately BEFORE it, so nothing — divider or
    // row — precedes the pinned row. (It used to be the scroll's first child; it moved out so the
    // tab can overflow sideways to break the rail's wall, and so it stops scrolling away.)
    expect(slot).not.toBeNull()
    expect(scroll?.contains(slot ?? null)).toBe(false)
    expect(slot?.nextElementSibling).toBe(scroll)
    expect(slot?.firstElementChild?.getAttribute('data-testid')).toBe('rail-pinned-list')
    expect(dividerLabels(r)).toEqual(['Needs you'])
  })

  it('groups are dividered Needs you → Working → Idle → Starting, in that order', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(updated(1, 'i', 'idle', 300))
      boardStore.getState().applyWatchEvent(updated(1, 'n', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(updated(1, 'w', 'working', 200))
      boardStore.getState().openLaunchedTerminal('tid-new', 'fresh', 'default')
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
    act(() => boardStore.getState().openLaunchedTerminal('tid-fresh', 'fresh', 'default'))
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

  // Review finding C (T-27/T-28): a button row's accessible name already carries its tags (the
  // aria-label is built from `label`, which folds in `tagSuffix`). The active row's sr-only name
  // span used to say only the name — a collapsed, active, TAGGED session announced no tags at
  // all, unlike every other row.
  it("the collapsed ACTIVE row's accessible text includes its tags too, like the button rows", () => {
    const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
    const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
    act(() => {
      tagsStore.getState().hydrate([DEPLOY, PROD])
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'a', 'working', 100, { tagIds: ['t-prod', 't-deploy'] }))
    })
    focusSession('a', 'tid-a')
    const r = render()
    act(() =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')?.click()
    )
    const collapsed = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(collapsed?.getAttribute('data-active')).not.toBeNull()
    expect(collapsed?.textContent).toContain('tags: deploy, prod')
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
  // way to `--bg-base`, the GROUND the terminal sits on, with hover previewing that fill. jsdom
  // applies no :hover and computes no colour, so the wiring is pinned by reading the stylesheet;
  // the DIRECTION (ground darker than rest) is pinned on the values in styles/tokens.test.ts.
  it('resting rows take the rest fill; hover and active take the SAME ground fill', () => {
    const css = readCss('./AttentionRail.module.css')
    expect(css).toMatch(/\.row\s*\{[^}]*background:\s*var\(--bg-row-rest\)/s)
    expect(css).toMatch(/\.row:not\(\.active\):hover\s*\{[^}]*background:\s*var\(--bg-base\)/s)
    expect(css).toMatch(/^\.active\s*\{[^}]*background:\s*var\(--bg-base\)/ms)
    // A not-yet-correlated launch is still a row in the same rail: same rest fill, same hover.
    expect(css).toMatch(/\.startingRow\s*\{[^}]*background:\s*var\(--bg-row-rest\)/s)
    expect(css).toMatch(/\.startingRow:hover\s*\{[^}]*background:\s*var\(--bg-base\)/s)
  })

  // The active row is a NOTCH cut THROUGH the rail's wall, not a chip sitting against it. It is
  // widened by the list's own right padding PLUS the wall's 1px, so it paints over the wall and
  // breaks the line for its own height; and every corner is rounded, so its top and bottom borders
  // curve into the wall rather than stopping square against it. Pinned on BOTH row kinds because
  // `.startingRow` is defined after `.active` and would otherwise win on source order.
  it('the active row reaches the wall with square right corners — in BOTH row kinds', () => {
    const css = readCss('./AttentionRail.module.css')
    // Both anchored to LINE START: unanchored, `.startingRow.active` also matches inside the
    // `.collapsed .startingRow.active` reset above it, and the test would read that block instead.
    //
    // The two rows no longer share ONE width. `.active` (the PINNED row) now stops its box
    // `--rounded-md` SHORT of the wall — the shoulder ARC that used to be its own `::before`/
    // `::after` moved to the slot's masked chrome layer (`.pinnedSlot::before`), and that arc
    // starts where the row's straight border must end, so the box gives up the strip the arc
    // owns (`.row.active::after` keeps it hit-testable; `padding-right` keeps the content box
    // where it was). `.startingRow.active` still paints its own paint-over shoulders and so
    // keeps the OLD width, reaching the wall itself.
    for (const [sel, widthRe] of [
      [
        /^\.active\s*\{([^}]*)/m,
        /width:\s*calc\(100% \+ var\(--space-2\) \+ 1px - var\(--rounded-md\)\)/
      ],
      [/^\.startingRow\.active\s*\{([^}]*)/m, /width:\s*calc\(100% \+ var\(--space-2\) \+ 1px\)/]
    ] as const) {
      const block = sel.exec(css)?.[1] ?? ''
      expect(block).toMatch(widthRe)
      // RIGHT corners SQUARE. The curve at that end flares OUTWARD, which `border-radius` cannot
      // draw — a radius bites INTO the box, and this bulges out of it. The slot's chrome layer (for
      // `.active`) / the `::before` / `::after` flares (for `.startingRow.active`) own that shape;
      // a right-hand radius here would fight them.
      expect(block).toMatch(/border-radius:\s*var\(--rounded-md\) 0 0 var\(--rounded-md\)/)
      // ...and the right edge stays OPEN on both, so the tab runs off toward the terminal instead
      // of closing into a box. `.startingRow`'s own `border: 1px solid transparent` shorthand is
      // defined after `.active` and wins at equal specificity, so that row has to restate this —
      // the 1px it costs is invisible (transparent, with the fill painting under it) but it
      // narrows the content box, which knocks the collapsed glyph out of the column of circles.
      expect(block).toMatch(/border-right-width:\s*0/)
    }
    // `.active`'s box gives up `--rounded-md` of width and gets it straight back as padding, so a
    // long name still ellipsizes at the same point it always has.
    expect(/^\.active\s*\{([^}]*)/m.exec(css)?.[1] ?? '').toMatch(
      /padding-right:\s*calc\(var\(--space-3\) - var\(--rounded-md\)\)/
    )
    // `.rowWrap` is `display: flex`, so the row is a FLEX ITEM and the default `flex-shrink: 1`
    // silently undoes the width above — the row rendered 8px short of the rail edge, still
    // floating. The width and the shrink guard are ONE fix; neither is meaningful alone.
    expect(/^\.active\s*\{([^}]*)/m.exec(css)?.[1] ?? '').toMatch(/flex-shrink:\s*0/)
    // ...and the COLLAPSED rail cuts the same tab, at square scale. It used to opt out — a centred
    // square with the squared corners reset — which was right while the tab merely ended at the
    // rail's edge, and wrong once it became a break in the wall: the wall is drawn in both states.
    // A plain `border-radius: var(--rounded-md)` here is the old reset coming back.
    const collapsedTab =
      /\.collapsed \.row\.active,\s*\.collapsed \.startingRow\.active\s*\{([^}]*)\}/s.exec(
        css
      )?.[1] ?? ''
    expect(collapsedTab, 'the collapsed active rule must exist').not.toBe('')
    expect(collapsedTab).toMatch(/border-radius:\s*var\(--rounded-md\) 0 0 var\(--rounded-md\)/)
  })

  // COLLAPSED TAB GEOMETRY — three declarations that only work as a set, in two different rules.
  // Each is individually deletable-looking, and dropping any one of them leaves the tab visibly
  // wrong rather than broken: no stretch and the tab centres itself mid-rail; no negative margin
  // and the wall runs unbroken across it; no right padding and the dot slides out of the column.
  //
  // This SHARED rule is unchanged by the rail-wall change and stays exactly what it was — but it
  // now describes the STARTING row's geometry only. The PINNED row (`.collapsed .row.active`) is
  // overridden below it, at equal specificity, so source order hands `.row.active` the later
  // values — see the next test.
  it('grows the collapsed square rightward ONTO the wall, and keeps the dot in the column', () => {
    const css = readCss('./AttentionRail.module.css')

    const rule = (selector: RegExp): string => selector.exec(css)?.[1] ?? ''
    const tab = rule(
      /\.collapsed \.row\.active,\s*\.collapsed \.startingRow\.active\s*\{([^}]*)\}/s
    )

    // The tab spans from the square's left edge to 1px past the rail's content edge — that last
    // pixel IS the wall, which is how the line breaks. Both halves are needed: the width alone
    // stops at the content edge, and `margin-right` alone would just shift the box.
    expect(tab).toMatch(/width:\s*calc\(100% - var\(--rail-tab-inset\) \+ 1px\)/)
    expect(tab).toMatch(/margin-right:\s*-1px/)
    // ...placed by the leftover space rather than by a second copy of the centring arithmetic.
    expect(tab).toMatch(/margin-left:\s*auto/)
    // ...which only exists because the ITEM stops shrink-wrapping the row (a shrink-wrapped item
    // would centre the tab in the rail, wall or no wall).
    expect(rule(/\.collapsed \.listItem:has\(\.active\)\s*\{([^}]*)\}/s)).toMatch(
      /align-self:\s*stretch/
    )

    // The dot stays in the column: the tab hands back everything it swallowed — the gutter, the
    // wall's 1px, and the 1px right border `.active` drops — as right padding, so `justify-content:
    // center` still centres over the 44px the square occupied.
    expect(tab).toMatch(/padding-right:\s*calc\(var\(--rail-tab-inset\) \+ 2px\)/)
    expect(rule(/^\.collapsed \.row\s*\{([^}]*)\}/ms)).toMatch(/justify-content:\s*center/)

    // The inset is DERIVED from the rail's own width, never typed in twice.
    expect(rule(/^\.rail\.collapsed\s*\{([^}]*)\}/ms)).toMatch(
      /--rail-tab-inset:\s*calc\(\(var\(--rail-width-collapsed\) - 1px - 44px\) \/ 2\)/
    )

    // ONE LINE, ONE COLOUR across the join. The tab's top and bottom borders are continued by the
    // shoulders and run into the wall, and both of those are `--border` — but a collapsed row
    // normally paints all four sides in its STATUS colour, so without these the arc would change
    // colour halfway round the curve. The status rule and this one tie at 0-3-0, which makes the
    // fix a source-order one: moving this rule above them puts the mismatch straight back.
    expect(tab).toMatch(/border-top-color:\s*var\(--border\)/)
    expect(tab).toMatch(/border-bottom-color:\s*var\(--border\)/)
    expect(css.indexOf(".collapsed .row[data-status='needs-you']")).toBeLessThan(
      css.indexOf('.collapsed .row.active,')
    )
  })

  // The PINNED collapsed tab (`.collapsed .row.active` alone, declared AFTER the shared rule
  // above) ends `--rounded-md` before the wall, same as the expanded `.active` — the shoulder
  // ARC lives on the slot's masked chrome layer now, not on this row, so the row's own box stops
  // where the arc begins. Width loses it, the right margin takes it (so `margin-left: auto` still
  // lands the left edge on the square's), and the right padding gives it straight back so the dot
  // stays centred over the 44px square.
  it('the PINNED collapsed tab ends short of the wall by --rounded-md, and gives the dot its centring back', () => {
    const css = readCss('./AttentionRail.module.css')
    const pinnedCollapsed = /^\.collapsed \.row\.active\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(pinnedCollapsed, 'the pinned collapsed override must exist').not.toBe('')
    expect(pinnedCollapsed).toMatch(
      /width:\s*calc\(100% - var\(--rail-tab-inset\) \+ 1px - var\(--rounded-md\)\)/
    )
    expect(pinnedCollapsed).toMatch(/margin-right:\s*calc\(var\(--rounded-md\) - 1px\)/)
    expect(pinnedCollapsed).toMatch(
      /padding-right:\s*calc\(var\(--rail-tab-inset\) \+ 2px - var\(--rounded-md\)\)/
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
    // `.rowTools` and `.startingRowName` out — chrome around a row, not the row. (The pencil and
    // the chevron are the shared Button now; their sizes live in Button.module.css.)
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

  // Task 9a fix (review round 1, Finding 1) — a workspace SWITCH must re-prime the announce
  // baseline, exactly like the mount-time priming above. Without the fix, every already-needs-you
  // session already sitting in the newly-active workspace gets diffed against the PREVIOUS
  // workspace's baseline and is wrongly announced as "new" on every switch (and again on every
  // switch back). The second assertion matters as much as the first: a fix that simply suppresses
  // every announcement after a switch would be worse than the bug it replaces.
  it("a workspace switch does NOT re-announce that workspace's pre-existing needs-you sessions, but a genuinely new one still IS announced", () => {
    // Seed BEFORE mount: 'a' needs-you in w1 (the workspace we mount into — present at mount, not
    // announced), 'b' needs-you in w2 (present at mount in a workspace we have not switched to
    // yet — must never surface while w1 is active, and must not poison w2's own priming either).
    workspacesStore.setState({ activeId: 'w1' })
    act(() => {
      boardStore
        .getState()
        .applyWatchEvent(
          updated(1, 'a', 'needs-you', 100, { sessionName: 'w1-preexisting', workspaceId: 'w1' })
        )
      boardStore
        .getState()
        .applyWatchEvent(
          updated(2, 'b', 'needs-you', 200, { sessionName: 'w2-preexisting', workspaceId: 'w2' })
        )
    })
    const r = render()
    const announcer = r.container.querySelector('[data-testid="live-announcer"]')
    expect(announcer?.textContent).toBe('') // mount priming for w1 — nothing announced yet

    // Switch the active workspace to w2. `focusWorkspace` is a boardStore action (it fires the
    // rail's `boardStore.subscribe` callback), which is how a real workspace switch reaches the
    // announce effect — mirrors how Task 9b's switcher will wire setActiveWorkspace + focusWorkspace.
    act(() => {
      workspacesStore.setState({ activeId: 'w2' })
      boardStore.getState().focusWorkspace('w2')
    })
    // 'b' was ALREADY needs-you before the switch — it must be re-primed into the baseline, NOT
    // announced as new. This is the exact defect: without the fix this assertion fails.
    expect(announcer?.textContent).toBe('')

    // A session that ENTERS needs-you in w2 AFTER the re-prime still IS announced — proving the
    // fix does not just blanket-suppress every announcement after a switch.
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(
          updated(3, 'c', 'needs-you', 300, { sessionName: 'w2-genuinely-new', workspaceId: 'w2' })
        )
    )
    expect(announcer?.textContent).toContain('w2-genuinely-new needs you')
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
      boardStore.getState().openLaunchedTerminal('tid-a', 'alpha', 'default')
      boardStore.getState().openLaunchedTerminal('tid-b', 'beta', 'default')
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
    act(() => boardStore.getState().openLaunchedTerminal('tid-x', 'xray', 'default'))
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
    act(() => boardStore.getState().openLaunchedTerminal('tid-y', 'yankee', 'default'))
    const onActivate = vi.fn()
    const r = render(onActivate)
    const row = r.container.querySelector<HTMLButtonElement>('[data-terminal-id="tid-y"]')
    act(() => row?.click())
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a correlated terminal (has card in sessionsById) does NOT appear as a starting row (supersede)', () => {
    // Launch + correlate + add a card — the terminal should disappear from the starting group.
    act(() => {
      boardStore.getState().openLaunchedTerminal('tid-corr', 'correlated', 'default')
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
    act(() => boardStore.getState().openLaunchedTerminal('tid-kbd', 'keyboard', 'default'))
    const r = render()
    const row = r.container.querySelector('[data-terminal-id="tid-kbd"]')
    expect(row?.tagName).toBe('BUTTON')
  })

  // Goal B: a collapsed rail is a column of CIRCLES — no initial letters. A normal RailRow gets
  // that for free (its StatusDot is the circle), but this row has no status dot by design, so it
  // renders a neutral hollow RING instead. It must render NO text: the letter is what Goal B
  // removed, and dropping it without a glyph would leave an empty button.
  it('in collapsed mode, starting row renders a neutral ring and NO text (no initial letter)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-coll', 'delta', 'default'))
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
      boardStore.getState().openLaunchedTerminal('tid-nv1', 'nv-alpha', 'default')
      boardStore.getState().openLaunchedTerminal('tid-nv2', 'nv-beta', 'default')
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

  /** Widest CENTRED square any `.collapsed` row rule declares — the one that gets clipped if the
   *  rail is sized to exactly fit. Swept rather than named so a new widest state cannot slip past.
   *
   *  `.active` rules are skipped on purpose, and it is the one exception: that row is not a centred
   *  square any more but a tab that grows rightward ONTO the wall, so it is SUPPOSED to end past the
   *  content edge. Seating it would mean shrinking it back inside the rail. Its own geometry is
   *  pinned by "grows the collapsed square rightward ONTO the wall" above. */
  const widestCollapsedSquare = (rail: string): number =>
    Math.max(
      ...[...rail.matchAll(/(\.collapsed [^{}]*)\{([^}]*)\}/g)]
        .filter((m) => !(m[1] ?? '').includes('.active'))
        .flatMap((m) =>
          [...(m[2] ?? '').matchAll(/^\s*width:\s*(\d+)px/gm)].map((w) => Number(w[1]))
        )
    )

  it('seats the row square with room to spare on both sides', () => {
    const tokens = readCss('../../styles/tokens.css')
    const rail = readCss('./AttentionRail.module.css')

    const collapsedWidth = px(/--rail-width-collapsed:\s*([\d.]+px)/.exec(tokens)?.[1])
    // The WIDEST collapsed square, whichever rule declares it — not a named selector, so a new
    // widest state cannot slip past by being written in a rule nobody thought to add here.
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
    const squareWidth = widestCollapsedSquare(rail)
    // The gutter is not just breathing room now — it is where the active tab grows FROM, so the
    // `--rail-tab-inset` above is this same number for the 44px square.
    const gutter = (collapsedWidth - RAIL_BORDER_PX - squareWidth) / 2

    expect(gutter).toBeGreaterThanOrEqual(4)
  })
})

describe('AttentionRail — tags (T-27, T-28)', () => {
  const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
  const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
  const readCss = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

  /** `tagged` carries prod + deploy (catalog order: deploy, prod); `plain` carries nothing. */
  function seed(): void {
    act(() => {
      tagsStore.getState().hydrate([DEPLOY, PROD])
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'tagged', 'working', 10, { tagIds: ['t-prod', 't-deploy'] }))
      boardStore.getState().applyWatchEvent(updated(1, 'plain', 'working', 20))
    })
  }

  function renderRail(props: Partial<AttentionRailProps> = {}): RenderResult {
    const r = renderComponent(<AttentionRail onActivateSession={() => {}} {...props} />)
    cleanup = r.unmount
    return r
  }

  /** The <li> holding a session's row, its tools and (when open) its peek panel. */
  const itemOf = (r: RenderResult, id: string): Element | null =>
    r.container.querySelector(`[data-session-id="${id}"]`)?.closest('li') ?? null

  it('a tagged row carries the compact indicator, in a peek toggle named after its tags', () => {
    seed()
    const r = renderRail()
    const peek = itemOf(r, 'tagged')?.querySelector('[data-testid="rail-tags-peek"]')
    expect(peek?.getAttribute('aria-expanded')).toBe('false')
    expect(peek?.getAttribute('aria-label')).toBe('Tags: deploy, prod')
    expect(peek?.querySelector('[data-testid="tag-indicator"]')).not.toBeNull()
    // Untagged, and tagging not wired: nothing to show and nothing to offer.
    expect(itemOf(r, 'plain')?.querySelector('[data-testid="rail-tags-peek"]')).toBeNull()
  })

  it('the default view never adds a chip line or a panel — a row height cannot follow its tags', () => {
    seed()
    const r = renderRail()
    expect(r.container.querySelector('[data-testid="rail-row-tags"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="rail-tags-panel"]')).toBeNull()
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(updated(2, 'plain', 'working', 20, { tagIds: ['t-deploy'] }))
    )
    expect(r.container.querySelector('[data-testid="rail-row-tags"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="rail-tags-panel"]')).toBeNull()
  })

  it('peek opens a panel with every chip; Edit opens the picker that sets the tags', () => {
    seed()
    const onSetSessionTags = vi.fn()
    const onActivateSession = vi.fn()
    const r = renderRail({ onSetSessionTags, onActivateSession })
    const peek = itemOf(r, 'tagged')?.querySelector<HTMLButtonElement>(
      '[data-testid="rail-tags-peek"]'
    )
    act(() => peek?.click())
    expect(peek?.getAttribute('aria-expanded')).toBe('true')
    const item = itemOf(r, 'tagged')
    const panel = item?.querySelector('[data-testid="rail-tags-panel"]')
    expect(
      [...(panel?.querySelectorAll('[data-testid="tag-chip"]') ?? [])].map((c) => c.textContent)
    ).toEqual(['deploy', 'prod'])
    act(() => item?.querySelector<HTMLButtonElement>('[data-testid="rail-tags-add"]')?.click())
    // A real click starts with a mousedown, and TagPicker closes on a mousedown outside its anchor:
    // the anchor must hold the list too, or the list is gone before the click lands.
    const check = (): HTMLButtonElement | null | undefined =>
      item?.querySelector<HTMLButtonElement>('[data-testid="rail-tag-picker-row-t-deploy"]')
    act(() => {
      check()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(check()).not.toBeNull()
    act(() => check()?.click())
    expect(onSetSessionTags).toHaveBeenCalledWith('tagged', ['t-prod'])
    // The toggle is a sibling of the row, not part of it: peeking never switches terminals.
    expect(onActivateSession).not.toHaveBeenCalled()
  })

  it('the peek draws INSIDE the row card, ending in a + tag whose real button stays outside the row', () => {
    seed()
    const r = renderRail({ onSetSessionTags: vi.fn() })
    const item = itemOf(r, 'tagged')
    act(() => item?.querySelector<HTMLButtonElement>('[data-testid="rail-tags-peek"]')?.click())
    const row = item?.querySelector('[data-session-id="tagged"]')
    const panel = item?.querySelector('[data-testid="rail-tags-panel"]')
    expect(panel).not.toBeNull()
    expect(row?.contains(panel ?? null)).toBe(true)
    expect(row?.hasAttribute('data-two-line')).toBe(true)
    // The ghost holds the pill's place as the LAST item of the chip flow, hidden from assistive tech.
    const ghost = panel?.querySelector('[data-testid="rail-tags-add-ghost"]')
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost?.parentElement?.lastElementChild).toBe(ghost)
    // A <button> cannot hold a <button>: the real `+ tag` is the row's sibling, laid over the ghost.
    const add = item?.querySelector('[data-testid="rail-tags-add"]')
    expect(add?.textContent).toBe('+ tag')
    expect(row?.contains(add ?? null)).toBe(false)
  })

  it('an untagged peek holds just the + tag — no chip, no "No tags" line', () => {
    seed()
    const r = renderRail({ onSetSessionTags: vi.fn() })
    const item = itemOf(r, 'plain')
    act(() => item?.querySelector<HTMLButtonElement>('[data-testid="rail-tags-peek"]')?.click())
    const panel = item?.querySelector('[data-testid="rail-tags-panel"]')
    expect(panel?.querySelectorAll('[data-testid="tag-chip"]')).toHaveLength(0)
    expect(panel?.querySelector('[data-testid="rail-tags-add-ghost"]')).not.toBeNull()
    expect(panel?.textContent).not.toContain('No tags')
    expect(item?.querySelector('[data-testid="rail-tags-add"]')).not.toBeNull()
  })

  it('the open toggle is LIT: its mark switches to the button ink, and closing restores the hues', () => {
    seed()
    const r = renderRail()
    const peek = itemOf(r, 'tagged')?.querySelector<HTMLButtonElement>(
      '[data-testid="rail-tags-peek"]'
    )
    const mono = (): boolean | undefined =>
      peek?.querySelector('[data-testid="tag-indicator"]')?.hasAttribute('data-mono')
    expect(mono()).toBe(false)
    act(() => peek?.click())
    expect(peek?.getAttribute('aria-expanded')).toBe('true')
    expect(mono()).toBe(true)
    expect(peek?.getAttribute('title')).toBe('Hide tags')
    act(() => peek?.click())
    expect(mono()).toBe(false)
    expect(r.container.querySelector('[data-testid="rail-tags-panel"]')).toBeNull()
  })

  // Controller ruling (T-11 in the caller): the rail's Edit picker offers ONLY global tags + the
  // row's OWN workspace's tags — never a tag scoped to some OTHER workspace.
  it("the Edit picker offers global + this row's own-workspace tags, never another workspace's", () => {
    const OWN: Tag = { id: 't-own', name: 'own', color: 'blue', workspaceId: 'default' }
    const OTHER: Tag = { id: 't-other', name: 'other-ws', color: 'violet', workspaceId: 'other' }
    act(() => {
      tagsStore.getState().hydrate([DEPLOY, PROD, OWN, OTHER])
      boardStore
        .getState()
        .applyWatchEvent(updated(1, 'tagged', 'working', 10, { tagIds: ['t-deploy'] }))
    })
    const r = renderRail({ onSetSessionTags: vi.fn() })
    const item = itemOf(r, 'tagged')
    act(() => item?.querySelector<HTMLButtonElement>('[data-testid="rail-tags-peek"]')?.click())
    act(() => item?.querySelector<HTMLButtonElement>('[data-testid="rail-tags-add"]')?.click())
    expect(item?.querySelector('[data-testid="rail-tag-picker-row-t-other"]')).toBeNull()
    expect(item?.querySelector('[data-testid="rail-tag-picker-row-t-own"]')).not.toBeNull()
    expect(item?.querySelector('[data-testid="rail-tag-picker-row-t-deploy"]')).not.toBeNull()
  })

  it('"Show all tags" gives every tagged row a one-line chip row — and only while it is on', () => {
    seed()
    const r = renderRail()
    const toggle = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-show-tags"]')
    expect(toggle?.getAttribute('aria-pressed')).toBe('false')
    act(() => toggle?.click())
    expect(toggle?.getAttribute('aria-pressed')).toBe('true')
    expect(itemOf(r, 'tagged')?.querySelector('[data-testid="rail-row-tags"]')).not.toBeNull()
    expect(itemOf(r, 'plain')?.querySelector('[data-testid="rail-row-tags"]')).toBeNull()
    act(() => toggle?.click())
    expect(r.container.querySelector('[data-testid="rail-row-tags"]')).toBeNull()
  })

  it('hides the header toggle while no tag exists (a control that does nothing is not rendered)', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'plain', 'working', 20)))
    const r = renderRail()
    expect(r.container.querySelector('[data-testid="rail-show-tags"]')).toBeNull()
  })

  it('the collapsed rail draws no tag icons; the row label names its tags instead', () => {
    seed()
    const r = renderRail()
    act(() =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')?.click()
    )
    expect(r.container.querySelector('[data-testid="rail-tags-peek"]')).toBeNull()
    expect(
      r.container.querySelector('[data-session-id="tagged"]')?.getAttribute('aria-label')
    ).toContain(', tags: deploy, prod')
  })

  it('an untagged row offers a hover "add tags" toggle when tagging is wired', () => {
    seed()
    const r = renderRail({ onSetSessionTags: vi.fn() })
    const peek = itemOf(r, 'plain')?.querySelector('[data-testid="rail-tags-peek"]')
    expect(peek?.getAttribute('aria-label')).toBe('Add tags to s-plain')
    expect(peek?.querySelector('[data-testid="tag-indicator"]')).toBeNull()
  })

  it('with no tags yet, an untagged row toggle opens tag management instead of a peek', () => {
    act(() => boardStore.getState().applyWatchEvent(updated(1, 'plain', 'working', 20)))
    const onManageTags = vi.fn()
    const onActivateSession = vi.fn()
    // No way to create a tag: nothing to show and nothing to offer.
    const bare = renderRail({ onSetSessionTags: vi.fn() })
    expect(itemOf(bare, 'plain')?.querySelector('[data-testid="rail-tags-peek"]')).toBeNull()
    bare.unmount()
    const r = renderRail({ onSetSessionTags: vi.fn(), onManageTags, onActivateSession })
    const peek = itemOf(r, 'plain')?.querySelector<HTMLButtonElement>(
      '[data-testid="rail-tags-peek"]'
    )
    if (peek == null) throw new Error('no tags toggle while tags can be created')
    expect(peek.getAttribute('aria-label')).toBe('Create tags')
    expect(peek.getAttribute('aria-haspopup')).toBe('dialog')
    expect(peek.hasAttribute('aria-expanded')).toBe(false)
    act(() => peek.click())
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(r.container.querySelector('[data-testid="rail-tags-panel"]')).toBeNull()
    expect(onActivateSession).not.toHaveBeenCalled()
  })

  it('CSS: the tools overlay the row, the untagged toggle hides until hover, tags only PAD the row', () => {
    const css = readCss('./AttentionRail.module.css')
    expect(/\.rowTools\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/position:\s*absolute/)
    // The reveal is on the WRAPPER (Button takes no className): hidden at rest, shown on hover /
    // focus-within, and held open by `data-open` while the peek is up and focus is in the picker.
    expect(/\.hoverTool\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/opacity:\s*0/)
    expect(css).toMatch(
      /\.rowWrap:hover \.hoverTool,\s*\.rowWrap:focus-within \.hoverTool,\s*\.hoverTool\[data-open\]\s*\{[^}]*opacity:\s*1/
    )
    // An untagged row's toggle is in a hover slot; a tagged row's is not (its mark is information).
    seed()
    const r = renderRail({ onSetSessionTags: vi.fn() })
    const slotOf = (id: string): string | undefined =>
      itemOf(r, id)?.querySelector('[data-testid="rail-tags-peek"]')?.parentElement?.className
    expect(slotOf('plain')).toContain('hoverTool')
    expect(slotOf('tagged')).not.toContain('hoverTool')
    const hasTags = /\.row\[data-has-tags\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(hasTags).toMatch(/padding-right/)
    expect(hasTags).not.toMatch(/height/)
  })

  it('open/on toggles are LIT (Button `lit`) like the filter toggle; + tag is laid over its ghost', () => {
    // The row's open peek toggle and the header's "Show all tags" while on are the shared Button's
    // `lit` state (`data-lit`, present only while on — Button.module.css owns the fill and ink).
    seed()
    const r = renderRail()
    const peek = itemOf(r, 'tagged')?.querySelector<HTMLButtonElement>(
      '[data-testid="rail-tags-peek"]'
    )
    const showAll = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-show-tags"]')
    expect(peek?.hasAttribute('data-lit')).toBe(false)
    expect(showAll?.hasAttribute('data-lit')).toBe(false)
    act(() => peek?.click())
    expect(peek?.hasAttribute('data-lit')).toBe(true)
    act(() => showAll?.click())
    expect(showAll?.hasAttribute('data-lit')).toBe(true)
    act(() => peek?.click())
    act(() => showAll?.click())
    expect(peek?.hasAttribute('data-lit')).toBe(false)
    expect(showAll?.hasAttribute('data-lit')).toBe(false)
    // The rail draws no lit rule of its own any more (comments stripped: they name the token).
    const css = readCss('./AttentionRail.module.css')
    const block = (re: RegExp): string => re.exec(css)?.[1] ?? ''
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/--text-on-lit|data-lit/)
    // Each wrapper scopes its own anchor; the ghost names it and stays invisible; the real button is
    // laid over it.
    expect(block(/\.rowWrap\s*\{([^}]*)\}/)).toMatch(/anchor-scope:\s*--rail-add-tag/)
    const ghost = block(/\.addTagGhost\s*\{([^}]*)\}/)
    expect(ghost).toMatch(/anchor-name:\s*--rail-add-tag/)
    expect(ghost).toMatch(/visibility:\s*hidden/)
    const button = block(/\.addTagButton\s*\{([^}]*)\}/)
    expect(button).toMatch(/position:\s*absolute/)
    expect(button).toMatch(/position-anchor:\s*--rail-add-tag/)
    // The default (`anchors-visible`) force-hides a box whose anchor is invisible — the ghost is.
    expect(button).toMatch(/position-visibility:\s*always/)
    expect(button).toMatch(/top:\s*anchor\(top\)/)
    expect(button).toMatch(/left:\s*anchor\(left\)/)
    // The panel under the row and the stacked Edit button are gone.
    expect(css).not.toMatch(/\.peekPanel|\.peekEdit|data-peek-edit/)
  })
})
