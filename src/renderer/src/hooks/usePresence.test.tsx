// Overlay motion (spec 2026-10-04 §3) — a closing overlay stays mounted for MOTION_EXIT_MS, but
// only after a pointer close and without reduced motion.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { pointerInput } from '../test/pointerInput'
import { MOTION_EXIT_MS } from '../styles/motion'
import { usePresentValue } from './usePresence'

function Harness({ value }: { value: string | null }): JSX.Element {
  const p = usePresentValue(value)
  return (
    <output data-testid="out" data-leaving={p.leaving ? '' : undefined}>
      {p.value ?? 'none'}
    </output>
  )
}

let r: RenderResult | undefined
let clearInput: (() => void) | undefined
const out = (): HTMLElement => {
  const el = r?.container.querySelector<HTMLElement>('[data-testid="out"]')
  if (el === null || el === undefined) throw new Error('missing harness output')
  return el
}
const show = (value: string | null): void =>
  act(() => {
    r?.root.render(<Harness value={value} />)
  })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  r?.unmount()
  r = undefined
  clearInput?.()
  clearInput = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('usePresentValue', () => {
  it('a pointer close keeps the last value, leaving, for MOTION_EXIT_MS', () => {
    clearInput = pointerInput()
    r = renderComponent(<Harness value="menu" />)
    show(null)
    expect(out().textContent).toBe('menu')
    expect(out().hasAttribute('data-leaving')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS - 1)
    })
    expect(out().textContent).toBe('menu')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(out().textContent).toBe('none')
    expect(out().hasAttribute('data-leaving')).toBe(false)
  })
  it('no input seen (jsdom .click()) → instant, like today', () => {
    r = renderComponent(<Harness value="menu" />)
    show(null)
    expect(out().textContent).toBe('none')
  })
  it('keyboard close → instant, even after a pointer open', () => {
    clearInput = pointerInput()
    r = renderComponent(<Harness value="menu" />)
    document.documentElement.dataset.input = 'keyboard'
    show(null)
    expect(out().textContent).toBe('none')
  })
  it('reduced motion → instant', () => {
    clearInput = pointerInput()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    r = renderComponent(<Harness value="menu" />)
    show(null)
    expect(out().textContent).toBe('none')
  })
  it('re-open during the exit cancels it: the value stays, not leaving, and no late unmount', () => {
    clearInput = pointerInput()
    r = renderComponent(<Harness value="menu" />)
    show(null)
    act(() => {
      vi.advanceTimersByTime(50)
    })
    show('menu')
    expect(out().hasAttribute('data-leaving')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS)
    })
    expect(out().textContent).toBe('menu')
  })
  it('a new value while open shows the new value at once', () => {
    r = renderComponent(<Harness value="a" />)
    show('b')
    expect(out().textContent).toBe('b')
  })
})
