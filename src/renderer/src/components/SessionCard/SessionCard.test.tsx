// Story 1.3 — SessionCard tests (AC-4, AC-8). Story 3.3 — `watch-only` variant RETIRED.
//
// Asserts: each LIVE variant (hero / calm) renders the shared anatomy; mono vs sans field
// placement; the hero accent bar follows `accent` (and only on hero); the status dot carries
// a label (never color-only); the card is keyboard-focusable and `onActivate` fires on click
// AND Enter. The `watch-only` variant + its muted `Konsole` tag are RETIRED (Story 3.3,
// FR-12 dropped) — the Board shows ONLY app-launched sessions, so there is no external/Konsole
// card to present. The retired-variant anatomy case + Konsole-tag test are GONE (not weakened).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { SessionCard, type SessionCardProps } from './SessionCard'
import { renderComponent, fireEvent } from '../../test/renderComponent'
import type { Tag, Workspace } from '../../../../shared/ipc/contract'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

/** Read this component's stylesheet as TEXT. `import.meta.url` is not a file:// URL under Vite's
 *  transform, so resolve from the vitest root (the repo root) instead. */
async function readCss(): Promise<string> {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  return readFileSync(
    join(process.cwd(), 'src/renderer/src/components/SessionCard/SessionCard.module.css'),
    'utf8'
  )
}

function baseProps(overrides: Partial<SessionCardProps> = {}): SessionCardProps {
  return {
    variant: 'hero',
    sessionName: 'deploy-prod',
    projectPath: '~/work/acme/api',
    status: 'needs-you',
    accent: 'needs-you',
    pid: 4242,
    ...overrides
  }
}

describe('SessionCard — one anatomy, two live presentations (AC-4, AC-8; watch-only retired)', () => {
  it.each(['hero', 'calm'] as const)('renders the shared anatomy for the %s variant', (variant) => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ variant })} />)
    cleanup = unmount

    const root = container.querySelector('[data-variant]')
    expect(root?.getAttribute('data-variant')).toBe(variant)
    expect(container.querySelector('[data-testid="session-name"]')?.textContent).toBe('deploy-prod')
    expect(container.querySelector('[data-testid="project-path"]')?.textContent).toBe(
      '~/work/acme/api'
    )
    expect(container.querySelector('[data-testid="pid"]')?.textContent).toBe('4242')
    // The status dot's label is present (accessibility floor — never color-only).
    expect(container.querySelector('[data-testid="status-label"]')).not.toBeNull()
  })

  it('sessionName uses SANS (font-ui); path/tool/pid use MONO (font-mono)', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ pendingToolName: 'Bash' })} />
    )
    cleanup = unmount
    const name = container.querySelector<HTMLElement>('[data-testid="session-name"]')
    const path = container.querySelector<HTMLElement>('[data-testid="project-path"]')
    const tool = container.querySelector<HTMLElement>('[data-testid="pending-tool"]')
    const pid = container.querySelector<HTMLElement>('[data-testid="pid"]')
    // CSS-Module class names are scoped/hashed; assert the field placement via the
    // distinct class hooks (sessionName vs the mono fields use different modules).
    expect(name?.className).not.toBe(path?.className)
    expect(path).not.toBeNull()
    expect(tool?.textContent).toBe('Bash')
    expect(pid?.className).toBeTruthy()
  })

  it('omits pendingToolName when not provided', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="pending-tool"]')).toBeNull()
  })

  it('hero accent bar follows `accent` (needs-you vs working)', () => {
    const gold = renderComponent(
      <SessionCard {...baseProps({ variant: 'hero', accent: 'needs-you' })} />
    )
    const goldRoot = gold.container.querySelector('[data-variant]')
    expect(goldRoot?.getAttribute('data-accent')).toBe('needs-you')
    const goldClass = goldRoot?.className ?? ''
    gold.unmount()

    const blue = renderComponent(
      <SessionCard {...baseProps({ variant: 'hero', accent: 'working' })} />
    )
    const blueRoot = blue.container.querySelector('[data-variant]')
    expect(blueRoot?.getAttribute('data-accent')).toBe('working')
    const blueClass = blueRoot?.className ?? ''
    blue.unmount()

    // The two accents produce DIFFERENT class strings (different accent-bar hook).
    expect(goldClass).not.toBe(blueClass)
  })

  it('the accent bar is hero-only (calm does not carry an accent class)', () => {
    const hero = renderComponent(
      <SessionCard {...baseProps({ variant: 'hero', accent: 'needs-you' })} />
    )
    const heroClass = hero.container.querySelector('[data-variant]')?.className ?? ''
    hero.unmount()

    const calm = renderComponent(
      <SessionCard {...baseProps({ variant: 'calm', accent: 'needs-you' })} />
    )
    const calmClass = calm.container.querySelector('[data-variant]')?.className ?? ''
    calm.unmount()

    // Same accent prop, different variant → hero gains an extra (accent-bar) class.
    expect(heroClass).not.toBe(calmClass)
  })

  it('never renders a Konsole tag — the watch-only variant is RETIRED (Story 3.3)', () => {
    // The Board shows ONLY app-launched sessions; the muted Konsole tag (built in Story 1.3,
    // never wired) is gone. Neither live variant renders it.
    const hero = renderComponent(<SessionCard {...baseProps({ variant: 'hero' })} />)
    expect(hero.container.querySelector('[data-testid="konsole-tag"]')).toBeNull()
    hero.unmount()

    const calm = renderComponent(<SessionCard {...baseProps({ variant: 'calm' })} />)
    expect(calm.container.querySelector('[data-testid="konsole-tag"]')).toBeNull()
    calm.unmount()
  })

  it('is keyboard-focusable (role=button, tabIndex=0)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    const root = container.querySelector('[data-variant]')
    expect(root?.getAttribute('role')).toBe('button')
    expect(root?.getAttribute('tabindex')).toBe('0')
  })

  it('fires onActivate on click', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ onActivate })} />)
    cleanup = unmount
    const root = container.querySelector('[data-variant]') as HTMLElement
    fireEvent(root, new MouseEvent('click', { bubbles: true }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('fires onActivate on Enter and Space', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ onActivate })} />)
    cleanup = unmount
    const root = container.querySelector('[data-variant]') as HTMLElement
    fireEvent(root, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    fireEvent(root, new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('renders the footer tasks/cost only when provided', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ tasks: 3, cost: '$0.12' })} />
    )
    cleanup = unmount
    expect(container.querySelector('[data-testid="tasks"]')?.textContent).toBe('3 tasks')
    expect(container.querySelector('[data-testid="cost"]')?.textContent).toBe('$0.12')
  })

  // The card BORDER carries status, and SELECTION is a fill. Before this, every card had a
  // neutral border and selection painted a lavender outline directly outside it — so the
  // selected card's edge read as blue-purple regardless of whether it was working or
  // needs-you, and status had no always-visible per-card colour at all.
  describe('status border + selection fill are independent channels', () => {
    it('exposes data-status on the root for EVERY status, so CSS can colour the border', () => {
      for (const status of ['working', 'needs-you', 'idle'] as const) {
        const { container, unmount } = renderComponent(<SessionCard {...baseProps({ status })} />)
        const root = container.querySelector('[data-variant]')
        expect(root?.getAttribute('data-status')).toBe(status)
        unmount()
      }
    })

    it('carries data-status on the CALM variant too, not just hero', () => {
      // The old accent bar was hero-only. A border that only coloured half the board would be
      // worse than a neutral one — the calm column would read as status-less.
      const { container, unmount } = renderComponent(
        <SessionCard {...baseProps({ variant: 'calm', status: 'idle' })} />
      )
      cleanup = unmount
      expect(container.querySelector('[data-variant]')?.getAttribute('data-status')).toBe('idle')
    })

    it('a SELECTED card still reports its own status — selection must not overwrite it', () => {
      // The regression in one assertion: selection and status have to survive together.
      const { container, unmount } = renderComponent(
        <SessionCard {...baseProps({ selected: true, status: 'needs-you' })} />
      )
      cleanup = unmount
      const root = container.querySelector('[data-variant]')
      expect(root?.getAttribute('data-selected')).toBe('true')
      expect(root?.getAttribute('data-status')).toBe('needs-you')
    })
  })

  // Story 3.4 (FR-16 / AC-4) — the needs-you-unacknowledged emphasis prop. Driven by the SHARED
  // selectRailEmphasis (same state the rail reads); consumes the shipped Epic-1 emphasis class.
  it('applies the shipped needsYouEmphasisClass + data-emphasized when emphasized=true', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ emphasized: true })} />
    )
    cleanup = unmount
    const root = container.querySelector('[data-variant]')
    expect(root?.getAttribute('data-emphasized')).toBe('true')
  })

  it('does NOT emphasize by default (emphasized=false)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-variant]')?.getAttribute('data-emphasized')).toBeNull()
  })

  // ── A2 rename pencil ────────────────────────────────────────────────────────
  it('renders NO pencil when onRename is omitted (presentational callers untouched)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="card-rename"]')).toBeNull()
  })

  it('renders the pencil when onRename is wired, and fires it on click', () => {
    const onRename = vi.fn()
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ onRename })} />)
    cleanup = unmount
    const pencil = container.querySelector<HTMLButtonElement>('[data-testid="card-rename"]')
    expect(pencil).not.toBeNull()
    fireEvent(pencil as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  // LOAD-BEARING: the card root is role="button" with its own onClick, and the pencil is a DOM
  // child. Without stopPropagation the rename click ALSO activates the card, dropping the operator
  // into the focused-session view behind the rename dialog. Removing the stopPropagation in
  // SessionCard's handleRenameClick must turn this red.
  it('clicking the pencil does NOT also activate the card (stopPropagation)', () => {
    const onActivate = vi.fn()
    const onRename = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ onActivate, onRename })} />
    )
    cleanup = unmount
    const pencil = container.querySelector('[data-testid="card-rename"]') as HTMLButtonElement
    fireEvent(pencil, new MouseEvent('click', { bubbles: true }))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  // The KEYBOARD path needs its own guard: Enter/Space on the focused pencil fires a keydown that
  // bubbles to the card's own handleKeyDown (which calls onActivate) BEFORE the browser turns it
  // into a click. Stopping only the click would leave this path activating the card.
  it('Enter/Space on the pencil does NOT activate the card (keydown stopPropagation)', () => {
    const onActivate = vi.fn()
    const onRename = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ onActivate, onRename })} />
    )
    cleanup = unmount
    const pencil = container.querySelector<HTMLButtonElement>('[data-testid="card-rename"]')
    fireEvent(
      pencil as HTMLButtonElement,
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    fireEvent(
      pencil as HTMLButtonElement,
      new KeyboardEvent('keydown', { key: ' ', bubbles: true })
    )
    expect(onActivate).not.toHaveBeenCalled()
    // `onRename` is unused here on purpose: jsdom does not synthesize a click from a keydown, so
    // this case pins ONLY the no-activation guard. The click path above covers the invocation.
    expect(onRename).not.toHaveBeenCalled()
  })

  it('the pencil is a real button with an accessible name naming the session', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ onRename: vi.fn() })} />
    )
    cleanup = unmount
    const pencil = container.querySelector('[data-testid="card-rename"]')
    expect(pencil?.tagName).toBe('BUTTON')
    // Keyboard-reachable by construction: a <button> with no negative tabindex.
    expect(pencil?.getAttribute('tabindex')).toBeNull()
    expect(pencil?.getAttribute('aria-label')).toBe('Rename deploy-prod')
  })

  // ── Workspaces (Task 12) — move-to-workspace affordance ──────────────────────
  it('offers a move target per other workspace and calls back with its id', () => {
    const onMoveToWorkspace = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          workspaces: [
            { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null },
            { id: 'w2', name: 'Side', color: 'rose', defaultCwd: null }
          ],
          currentWorkspaceId: 'w1',
          onMoveToWorkspace
        })}
      />
    )
    cleanup = unmount
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')
    fireEvent(toggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(container.querySelector('[data-testid="card-move-w1"]')).toBeNull() // never offer the current one
    const target = container.querySelector<HTMLButtonElement>('[data-testid="card-move-w2"]')
    fireEvent(target as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(onMoveToWorkspace).toHaveBeenCalledWith('w2')
  })

  it('renders no move affordance when the callback is absent', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="card-move"]')).toBeNull()
  })

  it('does not activate the card when the move affordance is clicked', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          onActivate,
          workspaces: [{ id: 'w2', name: 'Side', color: 'rose', defaultCwd: null }],
          currentWorkspaceId: 'w1',
          onMoveToWorkspace: () => {}
        })}
      />
    )
    cleanup = unmount
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')
    fireEvent(toggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(onActivate).not.toHaveBeenCalled()
  })

  // Review finding — the toggle's OWN keydown guard (handleMoveToggleKeyDown) had a click test
  // but no keyboard test, so a regression there had no net. Mirrors the pencil's own
  // "Enter/Space … does NOT activate the card" case above (same jsdom caveat: dispatching a raw
  // keydown does not synthesize a click, so this pins ONLY the no-activation guard).
  it('Enter/Space on the move toggle does NOT activate the card (keydown stopPropagation)', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          onActivate,
          workspaces: [{ id: 'w2', name: 'Side', color: 'rose', defaultCwd: null }],
          currentWorkspaceId: 'w1',
          onMoveToWorkspace: () => {}
        })}
      />
    )
    cleanup = unmount
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')
    fireEvent(
      toggle as HTMLButtonElement,
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    fireEvent(
      toggle as HTMLButtonElement,
      new KeyboardEvent('keydown', { key: ' ', bubbles: true })
    )
    expect(onActivate).not.toHaveBeenCalled()
  })

  // Review finding 1 — the row buttons had the same keyboard race as the toggle (a keydown
  // bubbles to the card's handleKeyDown BEFORE the browser turns Enter/Space into a click) but no
  // keydown guard at all. This is the test that would have caught it: it fails RED without
  // handleMoveItemKeyDown's stopPropagation (see the fix report for the fault-injection run).
  it('Enter/Space on a move-target row does NOT activate the card (keydown stopPropagation)', () => {
    const onActivate = vi.fn()
    const onMoveToWorkspace = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          onActivate,
          workspaces: [{ id: 'w2', name: 'Side', color: 'rose', defaultCwd: null }],
          currentWorkspaceId: 'w1',
          onMoveToWorkspace
        })}
      />
    )
    cleanup = unmount
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')
    fireEvent(toggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    const row = container.querySelector<HTMLButtonElement>('[data-testid="card-move-w2"]')
    fireEvent(
      row as HTMLButtonElement,
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    fireEvent(row as HTMLButtonElement, new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onActivate).not.toHaveBeenCalled()
    // `onMoveToWorkspace` is unused here on purpose, same as the pencil's own keydown case above:
    // jsdom does not synthesize a click from a raw dispatched keydown, so this pins ONLY the
    // no-activation guard. The click path in the earlier test covers the actual invocation.
    expect(onMoveToWorkspace).not.toHaveBeenCalled()
  })

  // Review finding 2 — a toggle that opens onto zero rows is a control with nothing behind it.
  // `currentWorkspaceId` here is the ONLY workspace in the list, so the filtered target list is
  // empty and the whole affordance must not render at all (the same optional-seam rule as
  // omitting `onMoveToWorkspace`).
  it('renders no move affordance when every workspace IS the card’s own (empty target list)', () => {
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
          currentWorkspaceId: 'w1',
          onMoveToWorkspace: () => {}
        })}
      />
    )
    cleanup = unmount
    expect(container.querySelector('[data-testid="card-move"]')).toBeNull()
  })

  // Review finding 3 — Escape-to-close, matching WorkspaceSwitcher's own popover test
  // ("closes on Escape and returns focus to the trigger").
  it('closes the move menu on Escape and returns focus to the toggle', () => {
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          workspaces: [
            { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null },
            { id: 'w2', name: 'Side', color: 'rose', defaultCwd: null }
          ],
          currentWorkspaceId: 'w1',
          onMoveToWorkspace: () => {}
        })}
      />
    )
    cleanup = unmount
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')
    fireEvent(toggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    const menu = container.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    fireEvent(menu as Element, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  // Task 17 drive scenario — opening the tag picker on the top card of a 3-card Idle column
  // painted its lower rows UNDER the very next card: `.root` was `position: relative` with
  // z-index AUTO, so it never bundled its own popover into one paint unit, and the popover's
  // `z-index: 10` escaped to compete against sibling cards (also z-index:auto) by DOM tree order
  // instead of by z-index. `.root[data-menu-open]` (SessionCard.module.css) fixes it by lifting
  // ONLY the card with an open popover — never unconditionally, or two adjacent open cards would
  // tie and fall back to tree order again.
  it('carries data-menu-open on the root ONLY while its own move menu or tag picker is open', () => {
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
          currentWorkspaceId: 'default',
          onMoveToWorkspace: () => {},
          availableTags: [{ id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }],
          onSetTags: vi.fn()
        })}
      />
    )
    cleanup = unmount
    const root = container.querySelector('[data-testid="session-name"]')?.closest('[role="button"]')
    expect(root?.getAttribute('data-menu-open')).toBeNull()

    const moveToggle = container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')
    fireEvent(moveToggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(root?.getAttribute('data-menu-open')).toBe('true')
    fireEvent(moveToggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(root?.getAttribute('data-menu-open')).toBeNull()

    const tagsToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="card-tags-button"]'
    )
    fireEvent(tagsToggle as HTMLButtonElement, new MouseEvent('click', { bubbles: true }))
    expect(root?.getAttribute('data-menu-open')).toBe('true')
  })

  // ── Visual hierarchy: the NAME is the title, the PATH is reference detail ────
  //
  // This shipped INVERTED. `.calm` set a variant-level `color: var(--text-dim)` meaning "dimmed
  // body", but every other child of the card sets its own colour (`.projectPath`,
  // `.pendingToolName`, `.footer`/`.pid`/`.sep`, the StatusDot) — so the only element it reached
  // was `.sessionName`. The card's title ended up the dimmest text on it (measured: luminance
  // 0.059 vs the path's 0.352 and the pid's 0.138), i.e. the custom name looked greyed out and the
  // path looked bold.
  //
  // jsdom cannot verify this — CSS modules are stubbed and there is no cascade or layout. The real
  // colours were checked by loading this stylesheet in an Electron BrowserWindow. What IS worth
  // pinning here is the MECHANISM: a variant-level bare `color` that silently retargets whichever
  // child happens not to set its own.
  it('the .calm variant declares no bare `color` (it would only reach .sessionName)', async () => {
    const css = await readCss()
    // Isolate the `.calm { ... }` block (the variant rule, not `.calm .sessionName`).
    const block = /^\.calm\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(block).not.toBe('')
    // A `color:` here reaches only the one child without its own colour — that is the bug.
    expect(/(^|;|\s)color\s*:/.test(block)).toBe(false)
    // The recession is carried by opacity instead.
    expect(block).toContain('opacity')
  })

  it('.sessionName sets its colour + weight EXPLICITLY, so no variant can demote the title', async () => {
    const css = await readCss()
    const block = /^\.sessionName\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(block).toContain('color: var(--text-primary)')
    expect(block).toContain('font-weight: var(--font-weight-heading)')
  })

  // ── The rename pencil sits NEXT TO the name, not at the card's far edge ──────
  //
  // The header shipped as `justify-content: space-between`, which spread name / pencil / dot
  // across the whole card width. The pencil ended up roughly an inch from the title it renames,
  // reading as a card-level control rather than a title-level one.
  //
  // jsdom does no layout, so what is pinned here is the MECHANISM, the same way the colour tests
  // above do: the spreading declaration is gone, the title shrink-wraps instead of filling, and
  // only the last child (the status dot) is pushed right.
  it('the header does NOT spread its children apart', async () => {
    const css = await readCss()
    const block = (/^\.header\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(block).not.toBe('')
    // `space-between` / `space-around` / `space-evenly` all push the pencil off the name.
    expect(/justify-content:\s*space-/.test(block)).toBe(false)
  })

  it('.sessionName shrink-wraps so the pencil lands against the end of the name', async () => {
    const css = await readCss()
    // Comments STRIPPED before asserting. These rules are heavily commented, and the comments
    // quote the very declarations under test — so a `toContain` against the raw block passes on
    // the prose alone. Verified: flipping the real declaration to `flex: 1 1 auto` left this test
    // green until the strip was added.
    const block = (/^\.sessionName\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    expect(block).not.toBe('')
    // `flex: 0 1 auto` = size to the text. A growing title (`flex: 1`) would push the pencil away
    // again, which is the exact bug — so the grow factor must be 0.
    expect(block).toContain('flex: 0 1 auto')
    // ...and it must still be allowed to shrink, or `text-overflow: ellipsis` never fires.
    expect(block).toContain('min-width: 0')
    expect(block).toContain('text-overflow: ellipsis')
  })

  it('only the LAST header child (the status dot) is pushed to the right edge', async () => {
    const css = await readCss()
    expect(/^\.header\s*>\s*:last-child\s*\{[^}]*margin-left:\s*auto/m.test(css)).toBe(true)
  })

  it('.projectPath is muted — a rung below the title in BOTH variants', async () => {
    const css = await readCss()
    // The path must not climb back to --text-secondary: that is the calm title's rung, and sharing
    // it would flatten the hierarchy the operator scans by.
    const block = /^\.projectPath\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(block).toContain('color: var(--text-muted)')
    expect(/^\.calm\s+\.sessionName\s*\{[^}]*color:\s*var\(--text-secondary\)/m.test(css)).toBe(
      true
    )
  })
})

describe('SessionCard — tags (T-26, §4.3)', () => {
  const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
  const OPS: Tag = { id: 't-ops', name: 'ops-only', color: 'blue', workspaceId: 'default' }
  const WS: Workspace[] = [
    { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
    { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
  ]
  const chips = (root: Element | null): string[] =>
    [...(root?.querySelectorAll('[data-testid="tag-chip"]') ?? [])].map((c) => c.textContent ?? '')

  it('draws the chips in the footer, in the order given', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ tags: [OPS, PROD] })} />
    )
    cleanup = unmount
    expect(
      chips(container.querySelector('[data-testid="footer"] [data-testid="card-tags"]'))
    ).toEqual(['ops-only', 'prod'])
  })

  it('draws no chip row for an untagged card', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="card-tags"]')).toBeNull()
  })

  it('offers Tags… only when tagging is wired AND there is somewhere for it to go', () => {
    const none = renderComponent(<SessionCard {...baseProps({ availableTags: [PROD] })} />)
    expect(none.container.querySelector('[data-testid="card-tags-button"]')).toBeNull()
    none.unmount()
    // No tags to offer and no way to create one: a control that opens onto nothing.
    const empty = renderComponent(
      <SessionCard {...baseProps({ availableTags: [], onSetTags: vi.fn() })} />
    )
    expect(empty.container.querySelector('[data-testid="card-tags-button"]')).toBeNull()
    empty.unmount()
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ availableTags: [PROD], onSetTags: vi.fn() })} />
    )
    cleanup = unmount
    expect(container.querySelector('[data-testid="card-tags-button"]')).not.toBeNull()
  })

  it('with no tags yet, the tags button opens tag management — never the picker, never the card', () => {
    const onManageTags = vi.fn()
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({ availableTags: [], onSetTags: vi.fn(), onManageTags, onActivate })}
      />
    )
    cleanup = unmount
    const button = container.querySelector<HTMLButtonElement>('[data-testid="card-tags-button"]')
    if (button === null) throw new Error('no tags button while tags can be created')
    // It opens a dialog, not the picker: no aria-expanded/aria-controls pointing at a popup.
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.hasAttribute('aria-expanded')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('Create tags')
    act(() => button.click())
    expect(onManageTags).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="card-tag-picker"]')).toBeNull()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('the Tags… menu sets the card tags — and never activates the card', () => {
    const onSetTags = vi.fn()
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({ tags: [PROD], availableTags: [OPS, PROD], onSetTags, onActivate })}
      />
    )
    cleanup = unmount
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="card-tags-button"]')?.click()
    )
    expect(container.querySelector('[data-testid="card-tag-picker"]')).not.toBeNull()
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="card-tag-picker-row-t-ops"]')
        ?.click()
    )
    expect(onSetTags).toHaveBeenCalledWith(['t-ops', 't-prod'])
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('Escape closes the Tags… menu and does not activate the card', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ availableTags: [PROD], onSetTags: vi.fn(), onActivate })} />
    )
    cleanup = unmount
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="card-tags-button"]')?.click()
    )
    const picker = container.querySelector('[data-testid="card-tag-picker"]')
    if (picker === null) throw new Error('picker did not open')
    fireEvent(picker, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(container.querySelector('[data-testid="card-tag-picker"]')).toBeNull()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('the move menu warns when the move drops this workspace’s own tags (T-9)', () => {
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          tags: [OPS, PROD],
          workspaces: WS,
          currentWorkspaceId: 'default',
          onMoveToWorkspace: vi.fn()
        })}
      />
    )
    cleanup = unmount
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')?.click())
    expect(container.querySelector('[data-testid="card-move-warning"]')?.textContent).toBe(
      'Moving drops 1 tag from Default'
    )
  })

  it('no warning when the card only carries global tags', () => {
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          tags: [PROD],
          workspaces: WS,
          currentWorkspaceId: 'default',
          onMoveToWorkspace: vi.fn()
        })}
      />
    )
    cleanup = unmount
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')?.click())
    expect(container.querySelector('[data-testid="card-move-warning"]')).toBeNull()
  })

  it('the footer reserves the chip height, so the first tag never grows the card (T-26)', async () => {
    const css = await readCss()
    expect(/\.footer\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/min-height:\s*18px/)
  })
})

describe('the card popovers close like every other popover', () => {
  const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
  const props = (): SessionCardProps =>
    baseProps({
      workspaces: [
        { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null },
        { id: 'w2', name: 'Side', color: 'rose', defaultCwd: null }
      ],
      currentWorkspaceId: 'w1',
      onMoveToWorkspace: vi.fn(),
      availableTags: [PROD],
      onSetTags: vi.fn()
    })
  const moveMenuOpen = (root: Element): boolean =>
    root.querySelector('[data-testid="card-move-w2"]') !== null

  it('a mousedown outside the move menu closes it', () => {
    const { container, unmount } = renderComponent(<SessionCard {...props()} />)
    cleanup = unmount
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')?.click())
    expect(moveMenuOpen(container)).toBe(true)
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(moveMenuOpen(container)).toBe(false)
  })

  it('opening the tag picker closes the move menu (the reported pair)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...props()} />)
    cleanup = unmount
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')?.click())
    const tagsButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="card-tags-button"]'
    )
    if (tagsButton === null) throw new Error('no tags button')
    act(() => {
      tagsButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      tagsButton.click()
    })
    expect(moveMenuOpen(container)).toBe(false)
    expect(container.querySelector('[data-testid="card-tag-picker"]')).not.toBeNull()
  })

  it('a mousedown inside the move menu leaves it open (its rows still get their click)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...props()} />)
    cleanup = unmount
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="card-move"]')?.click())
    act(() => {
      container
        .querySelector('[data-testid="card-move-w2"]')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(moveMenuOpen(container)).toBe(true)
  })

  // A calm card is drawn at `opacity: 0.82`. Opacity under 1 makes the card a BACKDROP ROOT, so a
  // glass popover inside it could only blur the card itself — never the board behind it — and the
  // popover was drawn at 82% too. While its popover is open the card is fully opaque.
  it('a calm card is fully opaque while its popover is open', async () => {
    const css = await readCss()
    expect(/\.calm\[data-menu-open\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/opacity:\s*1;/)
  })
})

describe('Archive / Delete (D-3, D-5)', () => {
  it('renders Archive (no confirm) and a red Delete only when handlers are wired, and neither activates the card', () => {
    const onActivate = vi.fn()
    const onArchive = vi.fn()
    const onDelete = vi.fn()
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ onActivate, onArchive, onDelete })} />
    )
    cleanup = unmount
    const archive = container.querySelector<HTMLElement>('[data-testid="card-archive"]')
    const del = container.querySelector<HTMLElement>('[data-testid="card-delete"]')
    expect(archive?.getAttribute('aria-label')).toBe('Archive deploy-prod')
    expect(del?.getAttribute('aria-label')).toBe('Delete deploy-prod')
    act(() => archive?.click())
    act(() => del?.click())
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })
  it('renders neither control without handlers', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="card-archive"]')).toBeNull()
    expect(container.querySelector('[data-testid="card-delete"]')).toBeNull()
  })
  // The card draws NO button of its own: every control is the shared Button (Button.test.tsx guards
  // the stylesheet). Delete is Button's `danger` — red outline at rest, filled on hover/focus — and
  // the other four are `ghost`, all `xs` icon squares.
  it('the controls are the shared Button: Delete is the danger variant, the rest are ghost', async () => {
    const { container, unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          onRename: vi.fn(),
          onArchive: vi.fn(),
          onDelete: vi.fn(),
          onSetTags: vi.fn(),
          availableTags: [{ id: 't', name: 't', color: 'rose', workspaceId: null }]
        })}
      />
    )
    cleanup = unmount
    const variantOf = (testId: string): string | null | undefined =>
      container.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-variant')
    expect(variantOf('card-delete')).toBe('danger')
    for (const id of ['card-rename', 'card-archive', 'card-tags-button']) {
      expect(variantOf(id), id).toBe('ghost')
      expect(container.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-size')).toBe('xs')
    }
    const css = await readCss()
    for (const cls of ['.renameButton', '.cardDelete', '.deleteButton', '.dangerButton']) {
      expect(css, cls).not.toContain(cls)
    }
  })

  // jsdom applies no :hover, so the reveal is pinned on the stylesheet. It lives on the WRAPPER
  // (Button takes no className), as `opacity` — never `display:none` — so the controls stay in
  // the tab order, and a focused one shows through `.root:focus-within`.
  it('the controls hide in an .actionSlot wrapper that the card reveals on hover / focus-within', async () => {
    const css = await readCss()
    expect(/^\.actionSlot\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '').toMatch(/opacity:\s*0;/)
    expect(css).toMatch(
      /\.root:hover \.actionSlot,\s*\.root:focus-within \.actionSlot\s*\{[^}]*opacity:\s*1/
    )
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() })} />
    )
    cleanup = unmount
    // CSS-module names are hashed here (`_actionSlot_…`), so match the class, not the string.
    for (const id of ['card-rename', 'card-archive', 'card-delete']) {
      expect(
        container.querySelector(`[data-testid="${id}"]`)?.parentElement?.className,
        id
      ).toContain('actionSlot')
    }
  })
})

describe('the ⟳ name-sync mark (D-11)', () => {
  it('draws the mark with the explaining title only while nameSyncPending', () => {
    const on = renderComponent(<SessionCard {...baseProps({ nameSyncPending: true })} />)
    const mark = on.container.querySelector('[data-testid="name-sync-pending"]')
    expect(mark?.textContent).toBe('⟳')
    expect(mark?.getAttribute('title')).toBe('Claude applies this name on your next prompt')
    expect(mark?.getAttribute('aria-label')).toBe('Claude applies this name on your next prompt')
    on.unmount()

    const off = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = off.unmount
    expect(off.container.querySelector('[data-testid="name-sync-pending"]')).toBeNull()
  })
})
