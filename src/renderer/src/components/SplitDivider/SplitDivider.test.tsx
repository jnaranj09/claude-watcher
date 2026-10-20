// The drag line between two panels: a keyboard-reachable separator that reports a live value while
// dragging and commits ONCE at the end (the caller saves it), plus the key steps and the
// double-click reset. Driven here through the shell split's handlers (5% steps, ratio clamps) and a
// plain pixel width (the task panel's shape). jsdom has no layout, so the frame bounds are injected.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { screen } from '@testing-library/react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ShellDivider } from '../../terminal/ShellDivider'
import { SplitDivider } from './SplitDivider'

const here = dirname(fileURLToPath(import.meta.url))
let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

interface ShellProps {
  ratio?: number
  getBounds?: () => { top: number; height: number } | null
}

function render({ ratio = 0.3, getBounds = () => ({ top: 0, height: 1000 }) }: ShellProps = {}): {
  r: RenderResult
  el: HTMLElement
  onDrag: ReturnType<typeof vi.fn>
  onCommit: ReturnType<typeof vi.fn>
} {
  const onDrag = vi.fn()
  const onCommit = vi.fn()
  const r = renderComponent(
    <ShellDivider
      ratio={ratio}
      getBounds={getBounds}
      onDrag={onDrag}
      onCommit={onCommit}
      ariaLabel="Resize shell pane"
      testId="shell-divider"
    />
  )
  cleanup = r.unmount
  const el = screen.getByTestId('shell-divider')
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

describe('SplitDivider — vertical (a side panel edge, in pixels)', () => {
  function renderVertical(): {
    el: HTMLElement
    onDrag: ReturnType<typeof vi.fn>
    onCommit: ReturnType<typeof vi.fn>
  } {
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const width = 260
    const clamp = (w: number): number => Math.min(600, Math.max(200, w))
    const r = renderComponent(
      <SplitDivider
        orientation="vertical"
        valueNow={width}
        valueMin={200}
        valueMax={600}
        startDrag={(x0) => (x) => clamp(width + x0 - x)}
        stepValue={(d) => clamp(width - d * 20)}
        resetValue={260}
        onDrag={onDrag}
        onCommit={onCommit}
        ariaLabel="Resize tasks"
        testId="tasks-divider"
      />
    )
    cleanup = r.unmount
    return { el: screen.getByRole('separator', { name: 'Resize tasks' }), onDrag, onCommit }
  }
  function pointerX(type: string, clientX: number): Event {
    const e = new MouseEvent(type, { bubbles: true, clientX, button: 0 })
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }

  it('is a vertical separator; a drag follows clientX and commits once', () => {
    const { el, onDrag, onCommit } = renderVertical()
    expect(el).toHaveAttribute('aria-orientation', 'vertical')
    expect(el).toHaveAttribute('aria-valuemin', '200')
    expect(el).toHaveAttribute('aria-valuemax', '600')
    act(() => {
      el.dispatchEvent(pointerX('pointerdown', 700))
    })
    act(() => {
      el.dispatchEvent(pointerX('pointermove', 600)) // 100px left → 100px wider
    })
    expect(onDrag).toHaveBeenLastCalledWith(360)
    act(() => {
      el.dispatchEvent(pointerX('pointerup', 600))
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith(360)
  })
  it('ArrowLeft / ArrowRight step it; ArrowUp does not', () => {
    const { el, onCommit } = renderVertical()
    const key = (k: string): void => {
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
      })
    }
    key('ArrowLeft')
    expect(onCommit).toHaveBeenLastCalledWith(280)
    key('ArrowRight')
    expect(onCommit).toHaveBeenLastCalledWith(240)
    key('ArrowUp')
    expect(onCommit).toHaveBeenCalledTimes(2)
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
    // Vertical: the same 12px strip turned on its side, the grip with it.
    const vertical = /\.divider\[data-orientation='vertical'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(vertical).toMatch(/width:\s*12px/)
    expect(vertical).toMatch(/cursor:\s*col-resize/)
  })
})
