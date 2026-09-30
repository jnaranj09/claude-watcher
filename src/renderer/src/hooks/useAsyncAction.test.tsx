// Action feedback (spec 2026-09-29 §1.4) — useAsyncAction is THE double-submit guard: a second
// run while one is in flight starts nothing, `busy` covers exactly the flight, and a rejection
// frees the button too.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { deferred } from '../test/deferred'
import { useAsyncAction } from './useAsyncAction'

let lastRun: Promise<void> | undefined

function Harness({ fn }: { fn: () => Promise<void> }): JSX.Element {
  const action = useAsyncAction(fn)
  return (
    <button
      type="button"
      data-testid="run"
      data-busy={action.busy ? 'yes' : 'no'}
      onClick={() => {
        lastRun = action.run()
        lastRun.catch(() => {})
      }}
    >
      run
    </button>
  )
}

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
  lastRun = undefined
  vi.restoreAllMocks()
})

function button(): HTMLButtonElement {
  const el = r?.container.querySelector<HTMLButtonElement>('[data-testid="run"]')
  if (el === null || el === undefined) throw new Error('missing harness button')
  return el
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAsyncAction', () => {
  it('a second run while one is in flight calls nothing; busy covers the flight', async () => {
    const d = deferred<void>()
    const fn = vi.fn(() => d.promise)
    r = renderComponent(<Harness fn={fn} />)
    expect(button().dataset['busy']).toBe('no')
    act(() => button().click())
    act(() => button().click())
    expect(fn).toHaveBeenCalledTimes(1)
    expect(button().dataset['busy']).toBe('yes')
    d.resolve()
    await settle()
    expect(button().dataset['busy']).toBe('no')
    act(() => button().click())
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('a rejection resets busy and the run promise rejects', async () => {
    const d = deferred<void>()
    r = renderComponent(<Harness fn={() => d.promise} />)
    act(() => button().click())
    expect(button().dataset['busy']).toBe('yes')
    d.reject(new Error('refused'))
    await settle()
    expect(button().dataset['busy']).toBe('no')
    await expect(lastRun).rejects.toThrow('refused')
  })

  it('runs the NEWEST fn (it closes over the latest render)', async () => {
    const first = vi.fn(() => Promise.resolve())
    const second = vi.fn(() => Promise.resolve())
    r = renderComponent(<Harness fn={first} />)
    act(() => r?.root.render(<Harness fn={second} />))
    act(() => button().click())
    await settle()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('a run that finishes after unmount resolves cleanly', async () => {
    const d = deferred<void>()
    r = renderComponent(<Harness fn={() => d.promise} />)
    act(() => button().click())
    const pending = lastRun
    r.unmount()
    r = undefined
    d.resolve()
    await settle()
    await expect(pending).resolves.toBeUndefined()
  })

  it('a synchronous throw from fn frees the guard: the next run calls fn again', async () => {
    const fn = vi.fn((): Promise<void> => {
      throw new Error('sync boom')
    })
    r = renderComponent(<Harness fn={fn} />)
    act(() => button().click())
    await settle()
    expect(button().dataset['busy']).toBe('no')
    await expect(lastRun).rejects.toThrow('sync boom')
    act(() => button().click())
    await settle()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
