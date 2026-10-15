// AttentionRail component tests, part 1: the rail's structure and interaction. jsdom `unit` project.
// Drives the rail against the singleton boardStore (reset per case by test/railHarness). Covers:
// always present + collapsible to icons; the pinned active row (not a control) and the status
// sections; needs-you emphasis applied (the SHIPPED needsYouEmphasisClass) and cleared on
// acknowledge; keyboard activation and aria-live; `railName.shortName`. The Starting group, rename,
// collapsed geometry, tags and theme hooks are in AttentionRail.rows.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { unmountRendered, type RenderResult } from '../../test/renderComponent'
import { resetRailStores, renderRail, renderRailWithRename } from '../../test/railHarness'
import { shortName } from './railName'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import { boardStore } from '../../stores/boardStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { tagsStore } from '../../stores/tagsStore'
import type { Tag } from '../../../../shared/ipc/contract'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { watchUpdated } from '../../../../__fixtures__/watchEvents'

beforeEach(() => {
  resetRailStores()
})

afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
})

describe('AttentionRail — always present + collapsible (AC-1, UX-DR9)', () => {
  it('is always present and lists one row per app-launched board session (same source as board)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'b', 'working', 200))
    })
    const r = renderRail()
    expect(r.container.querySelector('[data-testid="attention-rail"]')).not.toBeNull()
    const rows = r.container.querySelectorAll('[data-testid="rail-row"]')
    expect(rows.length).toBe(2)
  })

  it('each row shows a status dot + short name (never color-only — UX-DR29)', () => {
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100, { sessionName: 'deploy-prod' }))
    )
    const r = renderRail()
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
        .applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100, { sessionName: 'deploy-prod' }))
    )
    const r = renderRail()
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
        .applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100, { sessionName: 'deploy-prod' }))
    )
    const r = renderRail()
    const row = r.container.querySelector('[data-session-id="a"]')
    const label = row?.getAttribute('aria-label') ?? ''
    expect(label).toContain('deploy-prod')
    expect(label).toContain('Needs you')
  })

  it('collapses to icon-only rows (never hidden) — the rail and rows stay rendered', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100)))
    const r = renderRail()
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
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'work', 'working', 50))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'new-needs', 'needs-you', 300))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'old-needs', 'needs-you', 100))
    })
    const r = renderRail()
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
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'open', 'idle', 500))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'wants-you', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'busy', 'working', 200))
    })
    focusSession('open', 'tid-open')
    const r = renderRail()
    expect(rowOrder(r)[0]).toBe('open')
    expect(r.container.querySelector('[data-session-id="open"]')?.getAttribute('data-active')).toBe(
      'true'
    )
  })

  // A nav list that shows the same session twice reads as two sessions. The pinned row is filtered
  // out of its own group by `selectRailSection`.
  it('the ACTIVE session appears exactly once (pinned, NOT repeated in its status group)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'open', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'other', 'needs-you', 200))
    })
    focusSession('open', 'tid-open')
    const r = renderRail()
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
        .applyWatchEvent(watchUpdated(1, 'open', 'idle', 500, { sessionName: 'Review' }))
      boardStore
        .getState()
        .applyWatchEvent(watchUpdated(1, 'dep', 'needs-you', 100, { sessionName: 'Deploy' }))
      boardStore
        .getState()
        .applyWatchEvent(watchUpdated(1, 'rev2', 'needs-you', 200, { sessionName: 'Review two' }))
    })
    focusSession('open', 'tid-open')
    const r = renderRail()
    expect(rowOrder(r)).toEqual(['open', 'dep', 'rev2'])
    act(() => boardStore.getState().setSearchQuery('deploy'))
    expect(rowOrder(r)).toEqual(['open', 'dep'])
  })

  // "no need to advertise it is the current" — the pinned row's own fill + "(active)" in its
  // accessible name already say what it is, and a rule above it would push it into the list it is
  // deliberately standing outside of.
  it('the pinned row has NO divider above it — the first divider belongs to the first group', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'open', 'idle', 500))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'wants-you', 'needs-you', 100))
    })
    focusSession('open', 'tid-open')
    const r = renderRail()
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
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'i', 'idle', 300))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'n', 'needs-you', 100))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'w', 'working', 200))
      boardStore.getState().openLaunchedTerminal('tid-new', 'fresh', 'default')
    })
    const r = renderRail()
    expect(dividerLabels(r)).toEqual(['Needs you', 'Working', 'Idle', 'Starting'])
    expect(rowOrder(r)).toEqual(['n', 'w', 'i'])
  })

  // Three empty rules over a rail holding one session is furniture, not content.
  it('an EMPTY status group renders no divider and no list', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'w', 'working', 200)))
    const r = renderRail()
    expect(dividerLabels(r)).toEqual(['Working'])
    expect(r.container.querySelector('[data-testid="rail-section"][data-column="idle"]')).toBeNull()
    expect(
      r.container.querySelector('[data-testid="rail-section"][data-column="needs-you"]')
    ).toBeNull()
  })

  it('within a group, the longest-waiting session is first (oldest enteredColumnAt)', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'new-needs', 'needs-you', 300))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'old-needs', 'needs-you', 100))
    })
    const r = renderRail()
    expect(rowOrder(r)).toEqual(['old-needs', 'new-needs'])
  })

  // The divider is decoration (aria-hidden); the grouping reaches assistive tech through the
  // sibling list's accessible name. Without this, a screen-reader user gets four unlabelled lists.
  it('each group list carries the status as its accessible name; the divider is aria-hidden', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'n', 'needs-you', 100)))
    const r = renderRail()
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
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'idle', 100))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'b', 'needs-you', 200))
    })
    const r = renderRail()
    expect(r.container.querySelector('[data-testid="rail-pinned-list"]')).toBeNull()
    expect(rowOrder(r)).toEqual(['b', 'a'])
  })

  // A just-launched terminal has no session card yet, so nothing can be pinned. The rail must not
  // guess — it leaves the pin empty and the Starting row carries the active marker instead.
  it('a focused-but-uncorrelated launch pins nothing; the starting row is marked active', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-fresh', 'fresh', 'default'))
    const r = renderRail()
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
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    focusSession('a', 'tid-a')
    const onActivate = vi.fn()
    const r = renderRail(onActivate)
    const row = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(row?.tagName).not.toBe('BUTTON')
    act(() => row?.click())
    expect(onActivate).not.toHaveBeenCalled()
  })

  // Not a button and no tabIndex ⇒ it is out of the tab order. A focusable element that does
  // nothing when activated is a dead stop for a keyboard user.
  it('the active row is out of the tab order', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    focusSession('a', 'tid-a')
    const r = renderRail()
    const row = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(row?.getAttribute('tabindex')).toBeNull()
    expect(row?.tagName).not.toBe('BUTTON')
  })

  // A generic <div> does not reliably expose `aria-label`, so the active row's name and status
  // must be real content. Collapsed hides the name visually — it has to survive as sr-only text,
  // or the row announces a status with no session attached to it.
  it('the active row announces name + status as content, collapsed included', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100)))
    focusSession('a', 'tid-a')
    const r = renderRail()
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
        .applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { tagIds: ['t-prod', 't-deploy'] }))
    })
    focusSession('a', 'tid-a')
    const r = renderRail()
    act(() =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="rail-collapse"]')?.click()
    )
    const collapsed = r.container.querySelector<HTMLElement>('[data-session-id="a"]')
    expect(collapsed?.getAttribute('data-active')).not.toBeNull()
    expect(collapsed?.textContent).toContain('tags: deploy, prod')
  })

  it('the rename pencil still works on the active row, and is still a sibling not a child', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    focusSession('a', 'tid-a')
    const onRename = vi.fn()
    const r = renderRailWithRename(onRename)
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
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'b', 'working', 200))
    })
    focusSession('a', 'tid-a')
    const onActivate = vi.fn()
    const r = renderRail(onActivate)
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
      /padding-right:\s*calc\(var\(--inset-item-x\) - var\(--rounded-md\)\)/
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

  // TWO RAILS, TWO PAIRS (operator 2026-10-07): the OPEN rail's rows are 36px and its active row
  // 40px; the COLLAPSED rail keeps its 40px squares and the 44px active square. Each pair is one
  // small step, and only an `.active` rule spends the larger size.
  //
  // The load-bearing half is the active-only check. Needs-you used to enlarge 44->56px, and a size
  // driven by SESSION STATE reflows rows under the operator as sessions they are not watching
  // change status. The active row is different in kind — it changes only when the operator switches
  // session — so it is the one state allowed to spend size. Sweeping EVERY row rule (rather than
  // naming `.emphasized`) is what makes that hold for a state nobody has written yet.
  it('open rail: 36 rows + 40 active; collapsed: 40 squares + 44 active; only .active takes the larger', () => {
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

    // Two rails, two pairs. In each, the larger size is spent by an `.active` rule only — the
    // needs-you guard.
    const check = (group: typeof rules, expected: [number, number]): void => {
      expect(group.length).toBeGreaterThan(0)
      const sizes = [...new Set(group.flatMap((r) => r.sizes))].sort((a, b) => a - b)
      expect(sizes).toEqual(expected)
      for (const rule of group) {
        if (!rule.sizes.includes(expected[1])) continue
        expect(rule.selector, `${rule.selector} uses the active-only size`).toMatch(
          /\.active(?![A-Za-z])/
        )
      }
    }
    const collapsed = rules.filter((r) => r.selector.includes('.collapsed'))
    const open = rules.filter((r) => !r.selector.includes('.collapsed'))
    check(open, [36, 40])
    check(collapsed, [40, 44])
    // The OPEN step lives on `.active` itself (fault injection found this hole before).
    expect(/^\.active\s*\{([^}]*)/m.exec(css)?.[1] ?? '').toMatch(/min-height:\s*40px/)
  })

  it('section labels are one style: sentence case, 12 / 600, muted, no rules in the open rail', () => {
    const css = readCss('./AttentionRail.module.css')
    const body = (sel: string): string =>
      new RegExp(`\\n${sel.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    for (const sel of ['.title', '.dividerLabel']) {
      expect(body(sel), sel).not.toMatch(/text-transform|letter-spacing/)
      expect(body(sel), sel).toMatch(/font-size: var\(--font-size-label\);/)
      expect(body(sel), sel).toMatch(/font-weight: 600;/)
      expect(body(sel), sel).toMatch(/color: var\(--text-muted\);/)
    }
    expect(css).not.toMatch(/\n\.divider::before/)
    expect(css).toMatch(/\n\.collapsed \.divider::before,\s*\.collapsed \.divider::after \{/)
    expect(body('.name')).toMatch(/font-weight: 500;/)
  })
})

describe('AttentionRail — needs-you emphasis applied + cleared (AC-2, AC-4)', () => {
  it('a needs-you row carries the SHIPPED needsYouEmphasisClass; acknowledging clears it', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100)))
    const r = renderRail()
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
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'w', 'working', 100)))
    const r = renderRail()
    expect(
      r.container.querySelector('[data-session-id="w"]')?.getAttribute('data-emphasized')
    ).toBeNull()
  })

  it('the active row (the session being viewed) is highlighted', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
      boardStore.getState().addCorrelation('a', 'launch-a')
      boardStore.getState().switchTerminal('launch-a')
    })
    const r = renderRail()
    expect(r.container.querySelector('[data-session-id="a"]')?.getAttribute('data-active')).toBe(
      'true'
    )
  })
})

describe('AttentionRail — keyboard + aria-live (AC-5, UX-DR29)', () => {
  it('a row is a <button> activatable by keyboard (Enter = click), same effect as click', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100)))
    const onActivate = vi.fn()
    const r = renderRail(onActivate)
    const row = r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')
    expect(row?.tagName).toBe('BUTTON') // native button → Enter/Space activate it natively
    act(() => row?.click())
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('click invokes onActivateSession with the sessionId', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100)))
    const onActivate = vi.fn()
    const r = renderRail(onActivate)
    act(() => r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')?.click())
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('aria-live announces a session NEWLY entering needs-you (not one present at mount)', () => {
    // Present-at-mount needs-you session is NOT announced as new.
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100, { sessionName: 'preexisting' }))
    )
    const r = renderRail()
    const announcer = r.container.querySelector('[data-testid="live-announcer"]')
    expect(announcer?.textContent).toBe('')

    // A session that ENTERS needs-you after mount IS announced.
    act(() =>
      boardStore
        .getState()
        .applyWatchEvent(
          watchUpdated(2, 'b', 'needs-you', 200, { sessionName: 'deploy-prod-rose' })
        )
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
      boardStore.getState().applyWatchEvent(
        watchUpdated(1, 'a', 'needs-you', 100, {
          sessionName: 'w1-preexisting',
          workspaceId: 'w1'
        })
      )
      boardStore.getState().applyWatchEvent(
        watchUpdated(2, 'b', 'needs-you', 200, {
          sessionName: 'w2-preexisting',
          workspaceId: 'w2'
        })
      )
    })
    const r = renderRail()
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
      boardStore.getState().applyWatchEvent(
        watchUpdated(3, 'c', 'needs-you', 300, {
          sessionName: 'w2-genuinely-new',
          workspaceId: 'w2'
        })
      )
    )
    expect(announcer?.textContent).toContain('w2-genuinely-new needs you')
  })

  it('the rail itself has an aria-label nav region (keyboard-navigable landmark)', () => {
    const r = renderRail()
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
