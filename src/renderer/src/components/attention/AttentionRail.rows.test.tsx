// AttentionRail component tests, part 2: what a rail row can carry. jsdom `unit` project. Covers the
// Starting group (launched, not yet correlated), the rename affordance, the collapsed-rail
// geometry regression, the tag chips and tag filter, and the public theme hooks. Same harness as
// AttentionRail.test.tsx (test/railHarness).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import {
  renderTracked,
  unmountRendered,
  fireEvent,
  type RenderResult
} from '../../test/renderComponent'
import { resetRailStores, renderRail, renderRailWithRename } from '../../test/railHarness'
import { AttentionRail, type AttentionRailProps } from './AttentionRail'
import { boardStore } from '../../stores/boardStore'
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

describe('AttentionRail — Starting group (Story 5.6 rail gap)', () => {
  it('renders one calm starting row per selectStartingTerminals entry', () => {
    act(() => {
      boardStore.getState().openLaunchedTerminal('tid-a', 'alpha', 'default')
      boardStore.getState().openLaunchedTerminal('tid-b', 'beta', 'default')
    })
    const r = renderRail()
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
    const r = renderRail()
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
    const r = renderRail(onActivate)
    const row = r.container.querySelector<HTMLButtonElement>('[data-terminal-id="tid-y"]')
    act(() => row?.click())
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a correlated terminal (has card in sessionsById) does NOT appear as a starting row (supersede)', () => {
    // Launch + correlate + add a card — the terminal should disappear from the starting group.
    act(() => {
      boardStore.getState().openLaunchedTerminal('tid-corr', 'correlated', 'default')
      boardStore.getState().addCorrelation('sess-1', 'tid-corr')
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'sess-1', 'working', 100))
    })
    const r = renderRail()
    const startingSection = r.container.querySelector('[data-testid="starting-rail-section"]')
    // selectStartingTerminals excludes 'tid-corr' since sessionsById has its card.
    expect(startingSection).toBeNull()
    // The session row IS present in the normal rail list.
    expect(r.container.querySelectorAll('[data-testid="rail-row"]').length).toBe(1)
  })

  it('renders NO starting group when there are no starting terminals', () => {
    // No launched terminals at all.
    const r = renderRail()
    expect(r.container.querySelector('[data-testid="starting-rail-section"]')).toBeNull()
    expect(r.container.querySelectorAll('[data-testid="starting-rail-row"]').length).toBe(0)
  })

  it('starting row is a <button> activatable by keyboard (Enter = click)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-kbd', 'keyboard', 'default'))
    const r = renderRail()
    const row = r.container.querySelector('[data-terminal-id="tid-kbd"]')
    expect(row?.tagName).toBe('BUTTON')
  })

  // Goal B: a collapsed rail is a column of CIRCLES — no initial letters. A normal RailRow gets
  // that for free (its StatusDot is the circle), but this row has no status dot by design, so it
  // renders a neutral hollow RING instead. It must render NO text: the letter is what Goal B
  // removed, and dropping it without a glyph would leave an empty button.
  it('in collapsed mode, starting row renders a neutral ring and NO text (no initial letter)', () => {
    act(() => boardStore.getState().openLaunchedTerminal('tid-coll', 'delta', 'default'))
    const r = renderRail()
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
    const r = renderRail()
    // If StartingRailRow rendering were removed, this assertion would go RED.
    const rows = r.container.querySelectorAll('[data-testid="starting-rail-row"]')
    expect(rows.length).toBe(2)
  })
})

// ── A2 rename from the rail ───────────────────────────────────────────────────
describe('AttentionRail — rename affordance (session-naming A2)', () => {
  it('renders NO pencil when onRenameSession is omitted', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    const r = renderRail()
    expect(r.container.querySelector('[data-testid="rail-rename"]')).toBeNull()
  })

  it("renders a pencil per row when wired, and fires it with that row's session id", () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    const onRename = vi.fn()
    const r = renderRailWithRename(onRename)
    const pencil = r.container.querySelector<HTMLButtonElement>('[data-testid="rail-rename"]')
    expect(pencil).not.toBeNull()
    fireEvent(pencil as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a')
  })

  // The pencil must NOT be inside the row: the row is a real <button>, and nesting a button in a
  // button is invalid HTML (the browser un-nests it, which silently breaks the click target).
  // SessionCard can nest one because its root is a div[role=button]; this cannot.
  it('the pencil is a SIBLING of the row button, never nested inside it (valid HTML)', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    const r = renderRailWithRename(vi.fn())
    const row = r.container.querySelector('[data-testid="rail-row"]')
    const pencil = r.container.querySelector('[data-testid="rail-rename"]')
    expect(row).not.toBeNull()
    expect(pencil).not.toBeNull()
    expect(row?.contains(pencil as Node)).toBe(false)
    expect(pencil?.tagName).toBe('BUTTON')
  })

  it('clicking the pencil does NOT activate the row (they are separate controls)', () => {
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    const onActivate = vi.fn()
    const onRename = vi.fn()
    const r = renderRailWithRename(onRename, onActivate)
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
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100)))
    const r = renderRailWithRename(vi.fn())
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
        .applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { sessionName: 'deploy-prod' }))
    )
    const r = renderRailWithRename(vi.fn())
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
        .applyWatchEvent(
          watchUpdated(1, 'tagged', 'working', 10, { tagIds: ['t-prod', 't-deploy'] })
        )
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'plain', 'working', 20))
    })
  }

  function renderRail(props: Partial<AttentionRailProps> = {}): RenderResult {
    const r = renderTracked(<AttentionRail onActivateSession={() => {}} {...props} />)
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
        .applyWatchEvent(watchUpdated(2, 'plain', 'working', 20, { tagIds: ['t-deploy'] }))
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
        .applyWatchEvent(watchUpdated(1, 'tagged', 'working', 10, { tagIds: ['t-deploy'] }))
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
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'plain', 'working', 20)))
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
    act(() => boardStore.getState().applyWatchEvent(watchUpdated(1, 'plain', 'working', 20)))
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

describe('AttentionRail — public theme hooks', () => {
  it('exposes the rail, its head, headings and rows to themes', () => {
    act(() => {
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'open', 'idle', 500))
      boardStore.getState().applyWatchEvent(watchUpdated(1, 'busy', 'working', 200))
      boardStore.getState().addCorrelation('open', 'tid-open')
      boardStore.getState().switchTerminal('tid-open')
      boardStore.getState().openLaunchedTerminal('tid-fresh', 'fresh', 'default')
    })
    const r = renderRail()
    const c = r.container
    expect(c.querySelector('nav[data-rail]')).not.toBeNull()
    expect(c.querySelector('[data-rail-head] [data-rail-title]')?.textContent).toBe('Sessions')
    expect(c.querySelectorAll('[data-rail-heading]').length).toBeGreaterThan(0)
    expect(c.querySelector('[data-rail-row][data-active]')).not.toBeNull()
    expect(c.querySelector('[data-rail-row]:not([data-active])')).not.toBeNull()
    // The starting row carries the hook too.
    expect(c.querySelector('[data-testid="starting-rail-row"][data-rail-row]')).not.toBeNull()
  })
})
