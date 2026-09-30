// Action feedback (spec 2026-09-29 §1.4) — useFlash: a value that shows for FLASH_MS, restarts on a
// second flash, and never sets state after unmount.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { FLASH_MS, useFlash } from './useFlash'

function Harness({ ms }: { ms?: number }): JSX.Element {
  const [value, flash] = useFlash<string>(ms)
  return (
    <button type="button" data-testid="flash" onClick={() => flash('✓ Done')}>
      {value ?? 'idle'}
    </button>
  )
}

let r: RenderResult | undefined
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  r?.unmount()
  r = undefined
  vi.useRealTimers()
})

function button(): HTMLButtonElement {
  const el = r?.container.querySelector<HTMLButtonElement>('[data-testid="flash"]')
  if (el === null || el === undefined) throw new Error('missing harness button')
  return el
}

describe('useFlash', () => {
  it('shows the value, then clears it after FLASH_MS (1500)', () => {
    r = renderComponent(<Harness />)
    expect(FLASH_MS).toBe(1500)
    act(() => button().click())
    expect(button().textContent).toBe('✓ Done')
    act(() => {
      vi.advanceTimersByTime(FLASH_MS - 1)
    })
    expect(button().textContent).toBe('✓ Done')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(button().textContent).toBe('idle')
  })

  it('a second flash restarts the clock', () => {
    r = renderComponent(<Harness />)
    act(() => button().click())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    act(() => button().click())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(button().textContent).toBe('✓ Done')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(button().textContent).toBe('idle')
  })

  it('honours a custom duration', () => {
    r = renderComponent(<Harness ms={200} />)
    act(() => button().click())
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(button().textContent).toBe('idle')
  })

  it('unmount clears the pending timer', () => {
    r = renderComponent(<Harness />)
    act(() => button().click())
    expect(vi.getTimerCount()).toBe(1)
    r.unmount()
    r = undefined
    expect(vi.getTimerCount()).toBe(0)
  })

  it('advancing past the duration after unmount throws nothing', () => {
    r = renderComponent(<Harness />)
    act(() => button().click())
    r.unmount()
    r = undefined
    expect(() => vi.advanceTimersByTime(FLASH_MS * 2)).not.toThrow()
  })
})
