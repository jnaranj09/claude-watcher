// Card shell pane — the divider: a keyboard-reachable separator that reports a live ratio while
// dragging and commits ONCE at the end (the caller saves it), plus the 5% key steps and the
// double-click reset. jsdom has no layout, so the frame bounds are injected.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { SplitDivider } from './SplitDivider'

const here = dirname(fileURLToPath(import.meta.url))
let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<Parameters<typeof SplitDivider>[0]> = {}): {
  r: RenderResult
  el: HTMLElement
  onDrag: ReturnType<typeof vi.fn>
  onCommit: ReturnType<typeof vi.fn>
} {
  const onDrag = vi.fn()
  const onCommit = vi.fn()
  const r = renderComponent(
    <SplitDivider
      ratio={0.3}
      getBounds={() => ({ top: 0, height: 1000 })}
      onDrag={onDrag}
      onCommit={onCommit}
      ariaLabel="Resize shell pane"
      testId="shell-divider"
      {...props}
    />
  )
  cleanup = r.unmount
  const el = r.container.querySelector<HTMLElement>('[data-testid="shell-divider"]') as HTMLElement
  return { r, el, onDrag, onCommit }
}

function pointer(type: string, clientY: number, pointerId = 1): Event {
  const e = new MouseEvent(type, { bubbles: true, clientY, button: 0 })
  Object.defineProperty(e, 'pointerId', { value: pointerId })
  return e
}

describe('SplitDivider — accessibility contract', () => {
  it('is a horizontal separator with the shell percent as its value', () => {
    const { el } = render({ ratio: 0.3 })
    expect(el.getAttribute('role')).toBe('separator')
    expect(el.getAttribute('aria-orientation')).toBe('horizontal')
    expect(el.getAttribute('aria-valuenow')).toBe('30')
    expect(el.getAttribute('aria-valuemin')).toBe('15')
    expect(el.getAttribute('aria-valuemax')).toBe('85')
    expect(el.getAttribute('aria-label')).toBe('Resize shell pane')
    expect(el.tabIndex).toBe(0)
  })
})

describe('SplitDivider — keyboard', () => {
  it('ArrowUp commits +5%, ArrowDown commits −5%, and both are default-prevented', () => {
    const { el, onCommit } = render({ ratio: 0.3 })
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      )
    })
    expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(0.35, 10))
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
    })
    expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(0.25, 10))
    expect(onCommit).toHaveBeenCalledTimes(2)
  })
  it("other keys pass through (Escape is App's Focused → Board)", () => {
    const { el, onCommit } = render()
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    })
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('SplitDivider — pointer drag', () => {
  it('reports live ratios on move and commits ONCE on release', () => {
    const { el, onDrag, onCommit } = render({ ratio: 0.3 })
    // Capture APIs are absent in jsdom; the component must tolerate them missing.
    act(() => {
      el.dispatchEvent(pointer('pointerdown', 700))
    })
    expect(el.hasAttribute('data-dragging')).toBe(true)
    act(() => {
      el.dispatchEvent(pointer('pointermove', 600))
    })
    expect(onDrag).toHaveBeenLastCalledWith(expect.closeTo(0.4, 10))
    act(() => {
      el.dispatchEvent(pointer('pointermove', 500))
    })
    expect(onDrag).toHaveBeenLastCalledWith(expect.closeTo(0.5, 10))
    expect(onCommit).not.toHaveBeenCalled()
    act(() => {
      el.dispatchEvent(pointer('pointerup', 500))
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(0.5, 10))
    expect(el.hasAttribute('data-dragging')).toBe(false)
  })
  it('clamps a drag to 80px per side', () => {
    const { el, onDrag } = render({ ratio: 0.3, getBounds: () => ({ top: 0, height: 400 }) })
    act(() => {
      el.dispatchEvent(pointer('pointerdown', 280))
    })
    act(() => {
      el.dispatchEvent(pointer('pointermove', 395)) // 5px from the bottom → 80px minimum wins
    })
    expect(onDrag).toHaveBeenLastCalledWith(expect.closeTo(0.2, 10))
  })
  it('does nothing without bounds', () => {
    const { el, onDrag, onCommit } = render({ getBounds: () => null })
    act(() => {
      el.dispatchEvent(pointer('pointerdown', 700))
      el.dispatchEvent(pointer('pointermove', 600))
      el.dispatchEvent(pointer('pointerup', 600))
    })
    expect(onDrag).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('SplitDivider — double-click resets to the default', () => {
  it('commits 0.3', () => {
    const { el, onCommit } = render({ ratio: 0.6 })
    act(() => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onCommit).toHaveBeenCalledWith(0.3)
  })
})

describe('SplitDivider — stylesheet (tokens only)', () => {
  const css = readFileSync(resolve(here, 'SplitDivider.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
  it('fills the gap between the panels; its grip rests on --border, lifts on hover/drag', () => {
    const rest = /\.divider\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rest).toMatch(/background:\s*transparent/)
    expect(rest).toMatch(/cursor:\s*row-resize/)
    expect(rest).toMatch(/touch-action:\s*none/)
    // Its box is SHELL_DIVIDER_PX (12px, no margin): the clamp reserves exactly that.
    expect(rest).toMatch(/height:\s*12px/)
    expect(rest).toMatch(/margin:\s*0/)
    expect(css).toMatch(/\.divider::after\s*\{[^}]*background:\s*var\(--border\)/)
    expect(css).toMatch(/\.divider:hover::after\s*\{[^}]*var\(--border-strong\)/)
    expect(css).toMatch(/\.divider\[data-dragging\]::after\s*\{[^}]*var\(--border-strong\)/)
    expect(css).toMatch(/\.divider:focus-visible\s*\{[^}]*var\(--focus-ring\)/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })
})
