// Action feedback (spec 2026-09-29 §1.2) — the Toaster: a labelled region, status vs alert roles,
// ✕, the action, the action NOT rendered while a modal is open, hover/focus pausing the timer, and
// a workspace drawn as its tint.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { Toaster } from './Toaster'
import { createToastStore, TOAST_EXIT_MS, TOAST_MS } from '../../stores/toastStore'
import { boardStore } from '../../stores/boardStore'
import { manualClock } from '../../test/manualClock'

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
  act(() => boardStore.setState({ settingsDialogOpen: false }))
})

function setup(): {
  store: ReturnType<typeof createToastStore>
  clock: ReturnType<typeof manualClock>
} {
  const clock = manualClock()
  const store = createToastStore(clock)
  r = renderComponent(<Toaster store={store} />)
  return { store, clock }
}

const cards = (): HTMLElement[] => [
  ...(r?.container.querySelectorAll<HTMLElement>('[data-testid="toast"]') ?? [])
]

describe('Toaster', () => {
  it('is a region named Notifications', () => {
    setup()
    const region = r?.container.querySelector('[data-testid="toaster"]')
    expect(region?.tagName).toBe('SECTION')
    expect(region?.getAttribute('aria-label')).toBe('Notifications')
  })

  it('success/info are role=status, an error is role=alert; kind rides data-toast-kind', () => {
    const { store } = setup()
    act(() => {
      store.getState().push({ kind: 'success', title: 'ok' })
      store.getState().push({ kind: 'info', title: 'fyi' })
      store.getState().push({ kind: 'error', title: 'no' })
    })
    expect(cards().map((c) => [c.getAttribute('role'), c.dataset['toastKind']])).toEqual([
      ['status', 'success'],
      ['status', 'info'],
      ['alert', 'error']
    ])
    expect(cards().every((c) => c.hasAttribute('data-toast'))).toBe(true)
  })

  // Spec 2026-10-14 (pen node a5DXJY): success and info draw no kind glyph; an error keeps `!`.
  // Every toast keeps its ✕.
  it('only an error toast draws a glyph; every toast keeps ✕', () => {
    const { store } = setup()
    act(() => {
      store.getState().push({ kind: 'success', title: 'ok' })
      store.getState().push({ kind: 'info', title: 'fyi' })
      store.getState().push({ kind: 'error', title: 'no' })
    })
    const glyphs = cards().map((c) => c.querySelector(':scope > [data-kind]')?.textContent ?? null)
    expect(glyphs).toEqual([null, null, '!'])
    expect(cards().map((c) => c.querySelector('[data-testid="toast-dismiss"]') !== null)).toEqual([
      true,
      true,
      true
    ])
  })

  it('✕ dismisses: the toast fades (data-leaving) and is gone after the exit', () => {
    const { store, clock } = setup()
    act(() => void store.getState().push({ kind: 'error', title: 'no' }))
    const dismiss = r?.container.querySelector<HTMLButtonElement>('[data-testid="toast-dismiss"]')
    expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss')
    act(() => dismiss?.click())
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(true)
    act(() => clock.advance(TOAST_EXIT_MS))
    expect(cards()).toHaveLength(0)
  })

  it('the action button runs the action and closes the toast', () => {
    const { store } = setup()
    const run = vi.fn()
    act(
      () =>
        void store.getState().push({
          kind: 'success',
          title: 'Archived "api"',
          action: { label: 'Resume', icon: 'resume', run }
        })
    )
    const action = r?.container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')
    expect(action?.textContent).toBe('Resume')
    expect(action?.dataset['variant']).toBe('primary')
    const icon = action?.querySelector('svg')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('path')?.getAttribute('d')?.startsWith('M3 12a9 9')).toBe(true)
    act(() => action?.click())
    expect(run).toHaveBeenCalledTimes(1)
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(true)
  })

  it('the action is NOT rendered while a modal is open; ✕ still is; it comes back after', () => {
    const { store } = setup()
    act(
      () =>
        void store.getState().push({
          kind: 'success',
          title: 'x',
          action: { label: 'Open', icon: 'open', run: () => {} }
        })
    )
    act(() => boardStore.setState({ settingsDialogOpen: true }))
    expect(r?.container.querySelector('[data-testid="toast-action"]')).toBeNull()
    expect(r?.container.querySelector('[data-testid="toast-dismiss"]')).not.toBeNull()
    act(() => boardStore.setState({ settingsDialogOpen: false }))
    const back = r?.container.querySelector('[data-testid="toast-action"]')
    expect(back).not.toBeNull()
    expect(back?.querySelector('path')?.getAttribute('d')).toBe('M7 7h10v10')
  })

  it('a detail line carries its full text as a title', () => {
    const { store } = setup()
    act(() => void store.getState().push({ kind: 'info', title: 't', detail: 'a long line' }))
    const detail = cards()[0]?.querySelector('[title="a long line"]')
    expect(detail?.textContent).toBe('a long line')
  })

  it('a workspace is drawn as a WorkspaceLabel in its tint', () => {
    const { store } = setup()
    act(
      () =>
        void store.getState().push({
          kind: 'success',
          title: 'Moved "api" to',
          workspace: { name: 'Ops', tone: 'blue' }
        })
    )
    const label = cards()[0]?.querySelector('[data-tone="blue"]')
    expect(label?.textContent).toBe('Ops')
  })

  it('hovering pauses the timer; leaving resumes it', () => {
    const { store, clock } = setup()
    act(() => void store.getState().push({ kind: 'success', title: 'x' }))
    const card = cards()[0]
    if (card === undefined) throw new Error('no toast')
    fireEvent(card, new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    act(() => clock.advance(TOAST_MS * 3))
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(false)
    fireEvent(card, new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    act(() => clock.advance(TOAST_MS))
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(true)
  })

  it('focus inside a toast pauses its timer', () => {
    const { store, clock } = setup()
    act(() => void store.getState().push({ kind: 'success', title: 'x' }))
    const dismiss = r?.container.querySelector<HTMLButtonElement>('[data-testid="toast-dismiss"]')
    if (dismiss === null || dismiss === undefined) throw new Error('no ✕')
    fireEvent(dismiss, new FocusEvent('focusin', { bubbles: true }))
    act(() => clock.advance(TOAST_MS * 3))
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(false)
  })

  it('hover, focus, blur stays paused while the pointer is still over; leaving resumes', () => {
    const { store, clock } = setup()
    act(() => void store.getState().push({ kind: 'success', title: 'x' }))
    const card = cards()[0]
    const dismiss = r?.container.querySelector<HTMLButtonElement>('[data-testid="toast-dismiss"]')
    if (card === undefined || dismiss === null || dismiss === undefined) throw new Error('no toast')
    fireEvent(card, new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    fireEvent(dismiss, new FocusEvent('focusin', { bubbles: true }))
    fireEvent(dismiss, new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    act(() => clock.advance(TOAST_MS * 3))
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(false)
    fireEvent(card, new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    act(() => clock.advance(TOAST_MS))
    expect(cards()[0]?.hasAttribute('data-leaving')).toBe(true)
  })
})

// Spec 2026-10-14 — only an error draws a glyph (`!` in --danger); a success or info glyph rule
// coming back would colour nothing today and hide the next one that draws it.
describe('Toaster stylesheet', () => {
  const css = readFileSync(join(__dirname, 'Toaster.module.css'), 'utf8')
  it('colours the error glyph --danger', () => {
    expect(css).toMatch(/\.glyph\[data-kind='error'\]\s*\{[^}]*color:\s*var\(--danger\)/)
  })
  // The error rule sets the glyph's only colour; a base colour on `.glyph` would be dead.
  it('gives the base glyph rule no colour of its own', () => {
    const base = /\n\.glyph\s*\{([^}]*)\}/.exec(css)?.[1]
    expect(base).toBeDefined()
    expect(base).not.toMatch(/(^|[^-])color:/)
  })
  it('has no success or info glyph rule', () => {
    expect(css).not.toMatch(/data-kind=['"]?(success|info)/)
  })
})

describe('Toaster — shape', () => {
  it('a toast is at least as tall as the header, so it reads as the same rectangle', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Toaster/Toaster.module.css'),
      'utf8'
    )
    const toast = /\n\.toast\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(toast).toMatch(/min-height:\s*50px;/)
  })
})

describe('Toaster — motion (spec 2026-10-04 §7)', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/Toaster/Toaster.module.css'),
    'utf8'
  )
  it('enters and leaves by transition (interruptible), the same way: 8px below', () => {
    expect(css).not.toContain('@keyframes')
    expect(css).toMatch(/@starting-style\s*\{\s*\.toast\s*\{\s*opacity:\s*0;\s*translate:\s*0 8px;/)
    expect(css).toMatch(/\.toast\[data-leaving\]\s*\{[^}]*opacity:\s*0;[^}]*translate:\s*0 8px;/)
    expect(css).toMatch(/\.toast\[data-leaving\]\s*\{[^}]*var\(--motion-ease-exit\)/)
  })
  it('reduced motion keeps a fade with no movement', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toMatch(/translate:\s*none;/)
    expect(reduce).toMatch(/transition-property:\s*opacity;/)
  })
})
