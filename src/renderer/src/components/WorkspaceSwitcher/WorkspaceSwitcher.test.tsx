// The header workspace switcher: the trigger, the menu, keyboard and pointer use, and its CSS
// contracts. jsdom `unit` project. Renders through `renderComponent` and native DOM events (the
// repo does not install `@testing-library/react`; see src/renderer/src/test/renderComponent.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { fireEvent, q, renderComponent, type RenderResult } from '../../test/renderComponent'
import { boardStore } from '../../stores/boardStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { MOTION_EXIT_MS } from '../../styles/motion'
import { pointerInput } from '../../test/pointerInput'
import type { Column } from '../../../../shared/ipc/contract'
import { TOKENS } from '../../../../shared/theme/tokens'
import { cssRule, cssRules, readCss, shorthandParts } from '../../test/cssRule'

const rows = [
  { id: 'default', name: 'Default', color: 'slate' as const, defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue' as const, defaultCwd: null }
]

const STATUS_FOR: Record<Column, string> = {
  'needs-you': 'YourTurn',
  working: 'Working',
  idle: 'Idle'
}

function seedCard(workspaceId: string, id: string, column: Column): void {
  act(() => {
    boardStore.getState().applyWatchEvent({
      epoch: 0,
      event: {
        type: 'session.updated',
        id,
        sessionName: id,
        projectPath: '/p',
        status: STATUS_FOR[column],
        column,
        enteredColumnAt: 1,
        pid: 1,
        workspaceId,
        tagIds: []
      }
    })
  })
}

function seedNeedsYou(workspaceId: string, id: string): void {
  seedCard(workspaceId, id, 'needs-you')
}

let cleanup: (() => void) | undefined

// Captured ONCE, before any `vi.spyOn(boardStore.getState(), 'focusWorkspace')` runs — the
// pristine, never-mocked action. Needed because `vi.restoreAllMocks()` restores a spy on the
// OBJECT it was installed on, but `focusWorkspace`'s own real implementation calls `set(...)`,
// and zustand's `set` shallow-merges the CURRENT state (`{ ...get(), ...partial }`) into a NEW
// object — which copies the (still-mocked) `focusWorkspace` property FORWARD onto that new
// object too. `restoreAllMocks` never touches that new object, so the mock silently survives
// as the CURRENT `boardStore.getState().focusWorkspace` after the test that spied on it ends,
// and a LATER test's fresh `vi.spyOn` on the same (already-a-mock) property returns that same
// leftover instance instead of a clean one — its stale call history reads as a false positive
// in the next test. (Found empirically: "does not reconcile…" below failed only when run after
// "reconciles the focused view after a switch", never alone — a debug log confirmed this
// component's own guard was correctly NOT calling `focusWorkspace` in the failing run.)
const pristineFocusWorkspace = boardStore.getState().focusWorkspace

beforeEach(() => {
  workspacesStore.setState({ workspaces: rows, activeId: 'default', loaded: true })
  boardStore.setState({ sessionsById: {}, focusWorkspace: pristineFocusWorkspace })
  window.workspaces = {
    setActive: vi.fn().mockResolvedValue({ activeId: 'w1', workspaces: rows })
  } as never
})

let clearInput: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  clearInput?.()
  clearInput = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Belt-and-suspenders beyond restoreAllMocks — see the comment above `pristineFocusWorkspace`.
  boardStore.setState({ focusWorkspace: pristineFocusWorkspace })
})

function renderSwitcher(onManage: () => void = () => {}): RenderResult {
  const r = renderComponent(<WorkspaceSwitcher onManage={onManage} />)
  cleanup = r.unmount
  return r
}

function click(el: Element): void {
  fireEvent(el, new MouseEvent('click', { bubbles: true }))
}

// The switcher's hover rule: its own hover, or its anchor's elsewhere tab hovered (one control).
const SWITCHER_HOVER = '.switcher:hover,\n:where(.anchor:has(> .tab:hover)) > .switcher'

describe('WorkspaceSwitcher', () => {
  it('shows the active workspace name', () => {
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').textContent).toContain('Default')
  })

  // Spec 2026-10-14: lucide `layers` before the name, the same for every
  // workspace. Decorative: the aria-label (name and counts) is unchanged.
  it('draws the layers icon before the name, hidden from readers', () => {
    const r = renderSwitcher()
    const button = q(r, '[data-testid="workspace-switcher"]')
    const icon = button.firstElementChild
    expect(icon?.tagName.toLowerCase()).toBe('svg')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('path')?.getAttribute('d')?.startsWith('M12.83 2.18')).toBe(true)
    expect(icon?.nextElementSibling?.textContent).toBe('Default')
    expect(button.getAttribute('aria-label')).toBe('Default, 0 sessions')
  })

  it('draws no icon in a menu row or on the elsewhere tab', () => {
    seedCard('w1', 'd', 'idle')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-elsewhere-tab"]').querySelector('svg')).toBeNull()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(q(r, '[data-testid="workspace-row-w1"]').querySelector('svg')).toBeNull()
  })

  // The name and pills share a baseline; an svg on it sits high. A long name must never squeeze it.
  it('centres the icon on the cross axis and never shrinks it', () => {
    const css = readFileSync(join(__dirname, 'WorkspaceSwitcher.module.css'), 'utf8')
    const body = /\.switcher > svg\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(body).toMatch(/flex:\s*none;/)
    expect(body).toMatch(/align-self:\s*center;/)
  })

  // One pill per column: grey = idle, blue = working, yellow = needs you — so "4 sessions,
  // 1 working, 1 needs you" reads `2 (1) (1)`, never `4 (1)`.
  it('shows the active workspace idle, working and needs-you counts, inside the button', () => {
    seedCard('default', 'a', 'needs-you')
    seedCard('default', 'b', 'working')
    seedCard('default', 'c', 'idle')
    seedCard('default', 'e', 'idle')
    seedCard('w1', 'd', 'working')
    const r = renderSwitcher()
    const inButton = (id: string): string | null =>
      q(r, `[data-testid="workspace-switcher"] [data-testid="${id}"]`).textContent
    expect(inButton('workspace-card-count')).toBe('2')
    expect(inButton('workspace-working-count')).toBe('1')
    expect(inButton('workspace-here-badge')).toBe('1')
  })

  it('hides the blue count when nothing in the active workspace is working', () => {
    seedCard('default', 'c', 'idle')
    seedCard('w1', 'd', 'working')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-working-count"]')).toBeNull()
    expect(q(r, '[data-testid="workspace-card-count"]').textContent).toBe('1')
  })

  it('hides the grey count when every active card needs you — the pill alone, never 0 (1)', () => {
    seedNeedsYou('default', 'a')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-card-count"]')).toBeNull()
    expect(q(r, '[data-testid="workspace-here-badge"]').textContent).toBe('1')
  })

  it('hides the grey count when the active workspace has no cards — never a grey 0', () => {
    seedCard('w1', 'd', 'working')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-card-count"]')).toBeNull()
  })

  // The pill INSIDE the button means "this workspace needs you"; the tab BEHIND it means
  // "another one does". The old single badge sat inside and meant the second — which read as
  // the first (it pointed at the workspace on screen while the card was elsewhere).
  it('badges the active workspace inside the button and the OTHER ones on the tab', () => {
    seedNeedsYou('default', 'a')
    seedNeedsYou('w1', 'b')
    seedNeedsYou('w1', 'c')
    const r = renderSwitcher()
    const button = q(r, '[data-testid="workspace-switcher"]')
    expect(q(r, '[data-testid="workspace-here-badge"]').textContent).toBe('1')
    expect(button.contains(q(r, '[data-testid="workspace-here-badge"]'))).toBe(true)
    const tab = q(r, '[data-testid="workspace-elsewhere-tab"]')
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toBe('2')
    expect(tab.contains(q(r, '[data-testid="workspace-elsewhere-badge"]'))).toBe(true)
    expect(button.contains(tab)).toBe(false)
  })

  it('renders no tab when only the active workspace needs you', () => {
    seedNeedsYou('default', 'a')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-elsewhere-tab"]')).toBeNull()
  })

  it('renders no here-badge when only another workspace needs you', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-here-badge"]')).toBeNull()
  })

  // The tab is ONE neutral tab (spec 2026-09-29): a workspace's colour on it was read as a
  // session status. It carries the button's pills, summed over the OTHER workspaces (2026-09-30).
  it('shows grey and blue counts on a neutral tab when other workspaces have cards but none need you', () => {
    seedCard('w1', 'a', 'idle')
    seedCard('w1', 'b', 'working')
    const r = renderSwitcher()
    const tab = q(r, '[data-testid="workspace-elsewhere-tab"]')
    expect([...tab.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'workspace-elsewhere-count',
      'workspace-elsewhere-working'
    ])
    expect(q(r, '[data-testid="workspace-elsewhere-count"]').textContent).toBe('1')
    expect(q(r, '[data-testid="workspace-elsewhere-working"]').textContent).toBe('1')
    expect(tab.getAttribute('data-tone')).toBeNull()
    expect(q(r, '[data-testid="workspace-switcher"]').getAttribute('aria-label')).toBe(
      'Default, 0 sessions; 2 sessions in other workspaces'
    )
  })

  it('sums every other workspace on the tab and leaves the active one out', () => {
    workspacesStore.setState({
      workspaces: [...rows, { id: 'w2', name: 'Two', color: 'green', defaultCwd: null }]
    })
    seedCard('default', 'x', 'idle')
    seedCard('w1', 'a', 'idle')
    seedCard('w2', 'b', 'idle')
    seedCard('w2', 'c', 'working')
    seedNeedsYou('w1', 'd')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-elsewhere-count"]').textContent).toBe('2')
    expect(q(r, '[data-testid="workspace-elsewhere-working"]').textContent).toBe('1')
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toBe('1')
  })

  it('puts only the yellow count on the tab when every card elsewhere needs you', () => {
    workspacesStore.setState({
      workspaces: [
        ...rows,
        { id: 'w2', name: 'Two', color: 'green', defaultCwd: null },
        { id: 'w3', name: 'Three', color: 'rose', defaultCwd: null },
        { id: 'w4', name: 'Four', color: 'violet', defaultCwd: null }
      ]
    })
    seedNeedsYou('w4', 'a')
    seedNeedsYou('w3', 'b')
    seedNeedsYou('default', 'c')
    seedNeedsYou('w1', 'd')
    seedNeedsYou('w2', 'e')
    const r = renderSwitcher()
    const tab = q(r, '[data-testid="workspace-elsewhere-tab"]')
    expect([...tab.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'workspace-elsewhere-badge'
    ])
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toBe('4')
  })

  // A card whose workspace was deleted has no colour to draw — it still shows the tab and counts.
  it('counts a needs-you card in a deleted workspace on the tab', () => {
    seedNeedsYou('gone', 'a')
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toBe('2')
  })

  it('tints the button with the ACTIVE workspace colour and each menu row with its own', () => {
    workspacesStore.setState({ activeId: 'w1' })
    const r = renderSwitcher()
    const button = q(r, '[data-testid="workspace-switcher"]')
    expect(button.getAttribute('data-tone')).toBe('blue')
    click(button)
    expect(q(r, '[data-testid="workspace-row-default"]').getAttribute('data-tone')).toBe('slate')
  })

  // No workspace dot inside a menu row: the name is the only thing before the counts.
  it('draws no dot in a menu row', () => {
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(
      q(r, '[data-testid="workspace-row-w1"]').querySelector('[aria-hidden="true"]')
    ).toBeNull()
  })

  // The tint is the BACKGROUND and border; hover changes the border only, so the colour under the
  // pointer never changes.
  it('reads the tint in the stylesheet and hovers on the border', () => {
    const css = readFileSync(
      join(
        process.cwd(),
        'src/renderer/src/components/WorkspaceSwitcher/WorkspaceSwitcher.module.css'
      ),
      'utf8'
    )
    const block = (selector: string): string =>
      cssRule('components/WorkspaceSwitcher/WorkspaceSwitcher.module.css', selector)
    expect(block('.switcher')).toContain('background: var(--ws-fill, var(--bg-surface-raised))')
    expect(block('.switcher')).toContain('border: 1px solid var(--ws-border, var(--border-strong))')
    expect(block(SWITCHER_HOVER)).toContain('background: var(--ws-fill, var(--bg-surface))')
    expect(block(SWITCHER_HOVER)).toContain('border-color: var(--text-secondary)')
    expect(css).not.toContain('.tabDot')
  })

  // Drive 2026-10-09 (Liquid Glass, WebGL on): hovering the tab lit the TAB alone, and its film
  // painted across the part tucked under the translucent switcher — a lighter band inside the
  // pill. A click on the tab is a click on the switcher, so its hover is the switcher's hover: the
  // group selector lights the switcher, and the tab has no hover of its own. `:where()` keeps the
  // group rule at the switcher's own weight, so a theme's `[data-testid]:hover` still outranks it.
  it('hovering the elsewhere tab hovers the switcher, and the tab never lights itself', () => {
    const css = readFileSync(
      join(
        process.cwd(),
        'src/renderer/src/components/WorkspaceSwitcher/WorkspaceSwitcher.module.css'
      ),
      'utf8'
    )
    expect(css).toContain(`${SWITCHER_HOVER} {`)
    // No rule with the tab as its subject (the group selector names `.tab:hover` inside :has()).
    expect(css).not.toMatch(/^\s*\.tab:hover\b/m)
  })

  it('renders no tab when only the active workspace has cards', () => {
    seedCard('default', 'a', 'idle')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-elsewhere-tab"]')).toBeNull()
  })

  // The open menu lists every other workspace with its own pills; the tab's sums would count those
  // cards twice, so it tucks behind the button until the menu closes.
  it('tucks the tab behind the button while the menu is open', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    const tab = q(r, '[data-testid="workspace-elsewhere-tab"]')
    expect(tab.hasAttribute('data-tucked')).toBe(false)
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(tab.hasAttribute('data-tucked')).toBe(true)
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(tab.hasAttribute('data-tucked')).toBe(false)
    const rule = cssRule(
      'components/WorkspaceSwitcher/WorkspaceSwitcher.module.css',
      '.tab[data-tucked]'
    )
    expect(rule).toContain('transform: translateX(-100%)')
    expect(rule).toContain('opacity: 0')
  })

  // The tucked tab slides left by its OWN width. Under a short name ("Default") the tab with its
  // three pills was wider than the button, so it showed left of the button while it tucked (owner,
  // 2026-10-12). The button's min-width keeps the tucked tab's left edge strictly inside the
  // button, in the app's tokens and in every bundled theme's. The tab width is read from the
  // TAB's own rules, so a change to its padding, gap or pills that outgrows the button fails here.
  // Each pill is sized for a two-digit count (up to 99): two of the widest digit (--switcher-digit,
  // measured on the widest UI font) plus the pill's own side padding.
  it('the button is always wider than the tucked tab with its three two-digit pills', () => {
    const rules = cssRules(readCss('components/WorkspaceSwitcher/WorkspaceSwitcher.module.css'))
    // The LAST rule listing `sel` that sets `prop` wins, as in the cascade.
    const decl = (sel: string, prop: string): string => {
      const pattern = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`)
      const values = rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => pattern.exec(r.body)?.[1]?.trim())
        .filter((v) => v !== undefined)
      const last = values[values.length - 1]
      if (last === undefined) throw new Error(`no ${prop} on ${sel}`)
      return last
    }
    const themes = ['builtin-dark', 'liquid-glass', 'paper'].map((t) => {
      const file = join(process.cwd(), `docs/themes/examples/${t}/theme.json`)
      return { t, tokens: (JSON.parse(readFileSync(file, 'utf8')) as { tokens: object }).tokens }
    })
    for (const { t, tokens } of [{ t: 'app', tokens: {} }, ...themes]) {
      const vars: Record<string, string> = { ...TOKENS, ...tokens }
      const px = (v: string): number => {
        let e = v
        for (let i = 0; i < 20 && e.includes('var('); i++) {
          e = e.replace(/var\(--([\w-]+)(?:,[^()]*)?\)/g, (_, n: string) => {
            const token = vars[n]
            return `(${token ?? decl('.anchor', `--${n}`)})`
          })
        }
        e = e.replace(/calc/g, '').replace(/px/g, '')
        if (!/^[\d\s.+\-*/()]+$/.test(e)) throw new Error(`cannot evaluate ${v} → ${e}`)
        return Number(new Function(`return (${e})`)())
      }
      const pad = shorthandParts(decl('.tab', 'padding'))
      const tabPadding = px(pad[1] ?? '') + px(pad[3] ?? pad[1] ?? '')
      const tabBorder = 2 * px(shorthandParts(decl('.tab', 'border'))[0] ?? '')
      const pillPadding = 2 * px(shorthandParts(decl('.badge', 'padding'))[1] ?? '')
      const pill = Math.max(
        px(decl('.badge', 'min-width')),
        2 * px('var(--switcher-digit)') + pillPadding
      )
      const gap = px(decl('.tab', 'gap'))
      const strut = px(decl('.tab::before', 'margin-inline-end'))
      // The strut, then three pills: three gaps, the strut's negative margin eats the first.
      const tab = tabPadding + tabBorder + 3 * pill + 3 * gap + strut
      const overlap = -px(decl('.tab', 'margin-left'))
      const button = px(decl('.switcher', 'min-width'))
      // The tab's box starts `overlap` before the button's right edge; tucked, it moves left by
      // `tab`. Its left edge then sits this far right of the button's left edge.
      expect({ t, inside: button - overlap - tab > 0 }).toEqual({ t, inside: true })
    }
    // The name and the pills are ONE group, centred together in the wider box.
    expect(decl('.switcher', 'justify-content')).toBe('center')
  })

  it('opens the dropdown from the tab too', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-elsewhere-tab"]'))
    expect(r.container.querySelector('[role="menu"]')).not.toBeNull()
  })

  // The tab is aria-hidden (it is not its own Tab-key stop), so the button's accessible name
  // must carry every count. Review finding 3 — "1 sessions" reads wrong: every noun agrees.
  it('names every count in the button aria-label, singular for exactly one', () => {
    seedNeedsYou('default', 'a')
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').getAttribute('aria-label')).toBe(
      'Default, 1 session, 1 needs you; 1 session in other workspaces, 1 needs you'
    )
  })

  it('pluralizes the button aria-label and drops the counts that are zero', () => {
    seedCard('default', 'a', 'working')
    seedCard('default', 'b', 'idle')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').getAttribute('aria-label')).toBe(
      'Default, 2 sessions, 1 working'
    )
  })

  it('shows each row its idle, working and needs-you pills', () => {
    seedCard('w1', 'b', 'needs-you')
    seedCard('w1', 'c', 'working')
    seedCard('w1', 'e', 'idle')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(q(r, '[data-testid="workspace-row-count-w1"]').textContent).toBe('1')
    expect(q(r, '[data-testid="workspace-row-working-w1"]').textContent).toBe('1')
    expect(q(r, '[data-testid="workspace-row-needs-w1"]').textContent).toBe('1')
    expect(r.container.querySelector('[data-testid="workspace-row-working-default"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="workspace-row-count-default"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="workspace-row-needs-default"]')).toBeNull()
    // Read aloud, the row still gives the TRUE total — "2 sessions, 1 needs you" is accurate.
    expect(q(r, '[data-testid="workspace-row-w1"]').getAttribute('aria-label')).toBe(
      'Ops, 3 sessions, 1 working, 1 needs you'
    )
  })

  it('hides a row grey count when every card in that workspace needs you', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(r.container.querySelector('[data-testid="workspace-row-count-w1"]')).toBeNull()
    expect(q(r, '[data-testid="workspace-row-needs-w1"]').textContent).toBe('1')
  })

  // The pair reads the same in the button and in every row: grey first, then yellow. The rows
  // once put yellow first, so the same two pills swapped places when the menu opened.
  it('puts grey, then blue, then yellow in the button and in every row', () => {
    for (const ws of ['default', 'w1']) {
      seedCard(ws, `${ws}-n`, 'needs-you')
      seedCard(ws, `${ws}-w`, 'working')
      seedCard(ws, `${ws}-i`, 'idle')
    }
    const r = renderSwitcher()
    const inOrder = (...sels: string[]): boolean =>
      sels.every(
        (sel, k) =>
          k === 0 ||
          (q(r, sels[k - 1] ?? '').compareDocumentPosition(q(r, sel)) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0
      )
    expect(
      inOrder(
        '[data-testid="workspace-card-count"]',
        '[data-testid="workspace-working-count"]',
        '[data-testid="workspace-here-badge"]'
      )
    ).toBe(true)
    click(q(r, '[data-testid="workspace-switcher"]'))
    for (const id of ['w1']) {
      expect(
        inOrder(
          `[data-testid="workspace-row-count-${id}"]`,
          `[data-testid="workspace-row-working-${id}"]`,
          `[data-testid="workspace-row-needs-${id}"]`
        )
      ).toBe(true)
    }
  })

  // The button already names the active workspace: listing it again read as a duplicate
  // (operator, 2026-09-28).
  it('lists only the OTHER workspaces, never the active one', () => {
    seedNeedsYou('default', 'a')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(r.container.querySelector('[data-testid="workspace-row-default"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="workspace-row-w1"]')).not.toBeNull()
  })

  it('with no other workspace, the menu holds Manage only and no divider', () => {
    workspacesStore.setState({ workspaces: rows.filter((w) => w.id === 'default') })
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(r.container.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    expect(r.container.querySelector('[data-testid="workspace-manage"]')).not.toBeNull()
    expect(r.container.querySelector('[role="separator"]')).toBeNull()
  })

  it('lists every workspace with its own count and switches on click', async () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    const row = q(r, '[data-testid="workspace-row-w1"]')
    expect(row.textContent).toContain('Ops')
    expect(row.textContent).toContain('1')
    click(row)
    // `vi.waitFor` (Vitest's own, not RTL's) polls on a REAL timer, so — unlike a fixed
    // microtask-tick count — it cannot under-wait: a timer callback only fires after the
    // ENTIRE current microtask queue (including every `.then()` hop in the chain below) has
    // drained. See the "does not reconcile…" test below for why that matters here.
    await vi.waitFor(() => expect(window.workspaces.setActive).toHaveBeenCalledWith('w1'))
  })

  it('reconciles the focused view after a switch', async () => {
    const spy = vi.spyOn(boardStore.getState(), 'focusWorkspace')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-row-w1"]'))
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('w1'))
  })

  // Review finding 1 — `setActiveWorkspace` SWALLOWS an IPC rejection (workspacesStore.ts
  // catches + console.warn's; it never rethrows), so a resolved `.then()` is not proof main
  // confirmed the switch. Reconciling unconditionally would point the focused view at a
  // workspace the board/rail are not showing. Assert the NEGATIVE: on a refused switch,
  // `activeId` stays put and `focusWorkspace` is never called.
  //
  // Waiting for a NEGATIVE can't use `vi.waitFor` directly (there's nothing to poll for that
  // becomes true). Instead: spy `console.warn` (the catch branch's only observable effect —
  // also mocked away so the expected failure doesn't spam test output) and `vi.waitFor` on
  // THAT. Because `console.warn` and the risky `.then()` are both reached inside one
  // continuous microtask chain (no macrotask boundary between them), and `vi.waitFor` only
  // re-checks on a REAL timer, the entire chain — including the `.then()` — is guaranteed to
  // have finished by the time the wait resolves. (This is not a hypothetical: the very first
  // draft of this test used a fixed-tick `flush()` helper instead, and it went red — not
  // from this component, but from a PRIOR test's own under-drained click leaking a real
  // `focusWorkspace('w1')` call into this test's spy. Switching every wait in this file to
  // `vi.waitFor` fixed both the leaker and this test in one move.)
  it('does not reconcile the focused view when main refuses the switch', async () => {
    window.workspaces = {
      setActive: vi.fn().mockRejectedValue(new Error('refused'))
    } as never
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const focusSpy = vi.spyOn(boardStore.getState(), 'focusWorkspace')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-row-w1"]'))
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[claude-watcher][workspaces] code=workspaces_set_active_failed'
      )
    )
    expect(window.workspaces.setActive).toHaveBeenCalledWith('w1')
    expect(workspacesStore.getState().activeId).toBe('default')
    expect(focusSpy).not.toHaveBeenCalled()
  })

  // Review finding 2 — mirrors NewSessionButton.test.tsx's "Escape closes and returns focus to
  // the button" case for its sibling menu.
  it('closes on Escape and returns focus to the trigger', () => {
    const r = renderSwitcher()
    const trigger = q(r, '[data-testid="workspace-switcher"]')
    click(trigger)
    expect(r.container.querySelector('[role="menu"]')).not.toBeNull()
    fireEvent(q(r, '[role="menu"]'), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens the manage dialog from the popover', () => {
    const onManage = vi.fn()
    const r = renderSwitcher(onManage)
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-manage"]'))
    expect(onManage).toHaveBeenCalled()
  })

  // `Manage workspaces…` is a row like the others, so its hover fill is rounded like theirs. The
  // line above it used to be the button's own `border-top`, which forced `border-radius: 0` (a
  // rounded box bends its top border up at the corners) and drew a SQUARE hover under a rounded
  // menu. The line is its own element now, as in NewSessionMenu.
  it('draws the line above Manage workspaces… as its own separator, so the row stays rounded', () => {
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    const manage = q(r, '[data-testid="workspace-manage"]')
    expect(manage.previousElementSibling?.getAttribute('role')).toBe('separator')
    // Read from the repo root — `import.meta.url` is not a file: URL under the vite transform.
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Popover/Popover.module.css'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const manageRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel = '']) => /data-quiet/.test(sel))
      .map(([, , body = '']) => body)
      .join('\n')
    expect(manageRules).not.toMatch(/border-radius:\s*0\b/)
    expect(manageRules).not.toMatch(/border-top/)
  })

  it('draws its menu with Popover: the box, tinted workspace rows, and an untinted quiet Manage row', () => {
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    const menu = document.querySelector('[role="menu"]')
    expect(menu?.hasAttribute('data-popover')).toBe(true)
    const other = document.querySelector('[data-testid^="workspace-row-"][data-popover-item]')
    expect(other?.getAttribute('data-tone')).not.toBeNull()
    const manage = document.querySelector('[data-testid="workspace-manage"]')
    expect(manage?.hasAttribute('data-popover-item')).toBe(true)
    expect(manage?.hasAttribute('data-quiet')).toBe(true)
    expect(manage?.hasAttribute('data-tone')).toBe(false)
    expect(document.querySelector('[data-popover-divider]')).not.toBeNull()
  })
})

describe('WorkspaceSwitcher — tuck, then menu (spec 2026-10-04 §5)', () => {
  it('after a pointer close the tab stays tucked until the menu has gone', () => {
    clearInput = pointerInput()
    vi.useFakeTimers()
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    const tab = q(r, '[data-testid="workspace-elsewhere-tab"]')
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(r.container.querySelector('[role="menu"]')?.hasAttribute('data-leaving')).toBe(true)
    expect(tab.hasAttribute('data-tucked')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS)
    })
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
    expect(tab.hasAttribute('data-tucked')).toBe(false)
  })

  // Operator (2026-10-05): with no cards in other workspaces there is no tab to tuck, so the
  // menu must not wait for one.
  it('the menu waits for the tuck only while a tab is drawn', () => {
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-elsewhere-tab"]')).toBeNull()
    click(q(r, '[data-testid="workspace-switcher"]'))
    const wrap = r.container.querySelector('[role="menu"]')?.parentElement
    expect(wrap?.hasAttribute('data-after-tuck')).toBe(false)
    click(q(r, '[data-testid="workspace-switcher"]'))
    cleanup?.()
    seedNeedsYou('w1', 'b')
    const r2 = renderSwitcher()
    click(q(r2, '[data-testid="workspace-switcher"]'))
    const wrap2 = r2.container.querySelector('[role="menu"]')?.parentElement
    expect(wrap2?.hasAttribute('data-after-tuck')).toBe(true)
  })

  it('a pick keeps the rows it showed while the menu fades out', () => {
    clearInput = pointerInput()
    vi.useFakeTimers()
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(r.container.querySelector('[data-testid="workspace-row-w1"]')).not.toBeNull()
    click(q(r, '[data-testid="workspace-switcher"]'))
    act(() => {
      workspacesStore.setState({ activeId: 'w1' })
    })
    // Still the row the operator saw, though w1 is now active and no longer an "other".
    expect(r.container.querySelector('[data-testid="workspace-row-w1"]')).not.toBeNull()
  })

  it('CSS: the tab tucks on the enter curve, the menu waits for it, keyboard is instant', () => {
    const css = readFileSync(
      join(
        process.cwd(),
        'src/renderer/src/components/WorkspaceSwitcher/WorkspaceSwitcher.module.css'
      ),
      'utf8'
    )
    const tucked = css.slice(css.indexOf('.tab[data-tucked] {'))
    expect(tucked.slice(0, tucked.indexOf('}'))).not.toContain('ease-in')
    expect(css).toMatch(/\.tab\s*\{[^}]*transform var\(--motion-enter\) var\(--motion-ease-enter\)/)
    expect(css).toMatch(
      /\.menuWrap\[data-after-tuck\] > \[data-popover\]\s*\{\s*transition-delay:\s*var\(--motion-enter\);/
    )
    expect(css).not.toMatch(/\.menuWrap > \[data-popover\]\s*\{\s*transition-delay:\s*var/)
    expect(css).toMatch(
      /\.menuWrap > \[data-popover\]\[data-leaving\]\s*\{\s*transition-delay:\s*0s;/
    )
    expect(css).toMatch(/:root\[data-input='keyboard'\] \.tab\s*\{\s*transition:\s*none;/)
  })
})

describe('WorkspaceSwitcher — public theme hooks', () => {
  it('marks the switcher, its tab and every count for themes', () => {
    seedCard('default', 'a', 'needs-you')
    seedCard('default', 'a2', 'working')
    seedCard('default', 'a3', 'idle')
    seedCard('w1', 'b', 'needs-you')
    seedCard('w1', 'c', 'working')
    seedCard('w1', 'd', 'idle')
    const r = renderSwitcher()
    const button = q(r, 'button[data-workspace-switcher]')
    const tab = q(r, '[data-workspace-tab]')
    for (const count of ['total', 'working', 'needs-you']) {
      expect(button.querySelector(`[data-count="${count}"]`), `button ${count}`).not.toBeNull()
      expect(tab.querySelector(`[data-count="${count}"]`), `tab ${count}`).not.toBeNull()
    }
    // The menu rows carry the same three.
    click(button)
    const row = q(r, '[data-testid="workspace-row-w1"]')
    for (const count of ['total', 'working', 'needs-you']) {
      expect(row.querySelector(`[data-count="${count}"]`), `row ${count}`).not.toBeNull()
    }
  })
})
