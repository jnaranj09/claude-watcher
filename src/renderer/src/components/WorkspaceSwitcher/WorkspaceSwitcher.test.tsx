// Workspaces (Task 9b) — the header switcher tests. jsdom `unit` project.
//
// NOTE: this repo does NOT install `@testing-library/react` (Story 1.3 —
// src/renderer/src/test/renderComponent.ts: "avoids pulling RTL just for a handful of
// presentational components"), and Task 9a's own sibling tests (Board.test.tsx,
// AttentionRail.test.tsx) confirm that convention is still current today. The task-9 brief's
// Step 1 test imports `render`/`screen`/`fireEvent`/`waitFor` from `@testing-library/react`,
// which fails to resolve in this tree — verified with `npx vitest run` before writing this
// file. Same six cases, same assertions and testids, adapted to the existing
// `renderComponent` + native-DOM-event harness instead.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { boardStore } from '../../stores/boardStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { Column } from '../../../../shared/ipc/contract'

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

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  // Belt-and-suspenders beyond restoreAllMocks — see the comment above `pristineFocusWorkspace`.
  boardStore.setState({ focusWorkspace: pristineFocusWorkspace })
})

function renderSwitcher(onManage: () => void = () => {}): RenderResult {
  const r = renderComponent(<WorkspaceSwitcher onManage={onManage} />)
  cleanup = r.unmount
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

function click(el: Element): void {
  fireEvent(el, new MouseEvent('click', { bubbles: true }))
}

describe('WorkspaceSwitcher', () => {
  it('shows the active workspace name', () => {
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').textContent).toContain('Default')
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
    const block = (sel: string): string => {
      const i = css.indexOf(`${sel} {`)
      return css.slice(i, css.indexOf('}', i))
    }
    expect(block('.switcher')).toContain('background: var(--ws-fill, var(--bg-surface-raised))')
    expect(block('.switcher')).toContain('border: 1px solid var(--ws-border, var(--border-strong))')
    expect(block('.switcher:hover')).toContain('background: var(--ws-fill, var(--bg-surface))')
    expect(block('.switcher:hover')).toContain('border-color: var(--text-secondary)')
    expect(block('.row')).toContain('background: var(--ws-fill, transparent)')
    expect(block('.row')).toContain('border-color: var(--ws-border, transparent)')
    expect(css).not.toContain('.tabDot')
  })

  it('renders no tab when only the active workspace has cards', () => {
    seedCard('default', 'a', 'idle')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-elsewhere-tab"]')).toBeNull()
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
      join(
        process.cwd(),
        'src/renderer/src/components/WorkspaceSwitcher/WorkspaceSwitcher.module.css'
      ),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const manageRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel = '']) => /\.manage\b/.test(sel))
      .map(([, , body = '']) => body)
      .join('\n')
    expect(manageRules).not.toMatch(/border-radius:\s*0\b/)
    expect(manageRules).not.toMatch(/border-top/)
  })
})
