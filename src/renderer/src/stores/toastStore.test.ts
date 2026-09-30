// Action feedback (spec 2026-09-29 §1.1) — the toast store: the cap of 3, per-kind timers, pause /
// resume keeping the remaining time, an action that runs once and closes, and an injected clock.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createToastStore,
  toast,
  toastStore,
  TOAST_ACTION_MS,
  TOAST_EXIT_MS,
  TOAST_MAX,
  TOAST_MS
} from './toastStore'
import { manualClock } from '../test/manualClock'

afterEach(() => {
  toastStore.setState({ toasts: [] })
  vi.useRealTimers()
})

function setup(): {
  store: ReturnType<typeof createToastStore>
  clock: ReturnType<typeof manualClock>
} {
  const clock = manualClock()
  return { store: createToastStore(clock), clock }
}

const titles = (store: ReturnType<typeof createToastStore>): string[] =>
  store.getState().toasts.map((t) => t.title)

describe('toastStore', () => {
  it('push returns the id and adds a toast that is not leaving', () => {
    const { store } = setup()
    const id = store.getState().push({ kind: 'success', title: 'Saved' })
    expect(store.getState().toasts).toEqual([
      { id, kind: 'success', title: 'Saved', leaving: false }
    ])
  })

  it('success and info close after 5 s (then fade 150 ms); with an action after 6 s', () => {
    const { store, clock } = setup()
    expect(TOAST_MS).toBe(5000)
    expect(TOAST_ACTION_MS).toBe(6000)
    expect(TOAST_EXIT_MS).toBe(150)
    store.getState().push({ kind: 'success', title: 'a' })
    store.getState().push({ kind: 'info', title: 'b' })
    store.getState().push({ kind: 'success', title: 'c', action: { label: 'Go', run: () => {} } })
    clock.advance(TOAST_MS - 1)
    expect(store.getState().toasts.every((t) => !t.leaving)).toBe(true)
    clock.advance(1)
    expect(store.getState().toasts.map((t) => [t.title, t.leaving])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false]
    ])
    clock.advance(TOAST_EXIT_MS)
    expect(titles(store)).toEqual(['c'])
    clock.advance(TOAST_ACTION_MS - TOAST_MS - TOAST_EXIT_MS)
    expect(store.getState().toasts[0]?.leaving).toBe(true)
  })

  it('an error stays until dismissed', () => {
    const { store, clock } = setup()
    const id = store.getState().push({ kind: 'error', title: 'Could not archive "x".' })
    clock.advance(60_000)
    expect(titles(store)).toEqual(['Could not archive "x".'])
    store.getState().dismiss(id)
    clock.advance(TOAST_EXIT_MS)
    expect(titles(store)).toEqual([])
  })

  it('at most 3 on screen: a 4th drops the oldest at once', () => {
    const { store } = setup()
    expect(TOAST_MAX).toBe(3)
    for (const title of ['1', '2', '3', '4']) store.getState().push({ kind: 'error', title })
    expect(titles(store)).toEqual(['2', '3', '4'])
  })

  it('pause keeps the remaining time; resume restarts it', () => {
    const { store, clock } = setup()
    const id = store.getState().push({ kind: 'success', title: 'x' })
    clock.advance(2000)
    store.getState().pause(id)
    clock.advance(60_000)
    expect(store.getState().toasts[0]?.leaving).toBe(false)
    store.getState().resume(id)
    clock.advance(2999)
    expect(store.getState().toasts[0]?.leaving).toBe(false)
    clock.advance(1)
    expect(store.getState().toasts[0]?.leaving).toBe(true)
  })

  it('an error has no timer to pause: pause/resume leave it standing', () => {
    const { store, clock } = setup()
    const id = store.getState().push({ kind: 'error', title: 'x' })
    store.getState().pause(id)
    store.getState().resume(id)
    clock.advance(60_000)
    expect(store.getState().toasts[0]?.leaving).toBe(false)
  })

  it('an action runs once and closes its toast; the store does not await it', () => {
    const { store } = setup()
    let finish: () => void = () => {}
    const run = vi.fn(
      () =>
        new Promise<void>((res) => {
          finish = () => res()
        })
    )
    const id = store
      .getState()
      .push({ kind: 'success', title: 'x', action: { label: 'Resume', run } })
    store.getState().runAction(id)
    expect(run).toHaveBeenCalledTimes(1)
    expect(store.getState().toasts[0]?.leaving).toBe(true)
    store.getState().runAction(id)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
  })

  it('an action that throws, synchronously or by rejection, is contained and still closes', async () => {
    const { store } = setup()
    const a = store.getState().push({
      kind: 'info',
      title: 'a',
      action: {
        label: 'Go',
        run: () => {
          throw new Error('boom')
        }
      }
    })
    const b = store.getState().push({
      kind: 'info',
      title: 'b',
      action: { label: 'Go', run: () => Promise.reject(new Error('boom')) }
    })
    expect(() => store.getState().runAction(a)).not.toThrow()
    store.getState().runAction(b)
    await Promise.resolve()
    expect(store.getState().toasts.map((t) => t.leaving)).toEqual([true, true])
  })

  it('dismiss is idempotent: a second dismiss schedules no second removal', () => {
    const base = manualClock()
    const setTimer = vi.spyOn(base, 'setTimer')
    const store = createToastStore(base)
    const clock = base
    const id = store.getState().push({ kind: 'info', title: 'x' })
    const armed = setTimer.mock.calls.length
    store.getState().dismiss(id)
    store.getState().dismiss(id)
    expect(setTimer.mock.calls.length - armed).toBe(1)
    clock.advance(TOAST_EXIT_MS)
    expect(titles(store)).toEqual([])
  })

  it('toast.success / error / info push onto the app singleton', () => {
    vi.useFakeTimers()
    toast.success('Archived "api"', { action: { label: 'Resume', run: () => {} } })
    toast.error('Could not update tags.')
    toast.info('Still starting "api"…', { detail: 'one line' })
    expect(toastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([
      ['success', 'Archived "api"'],
      ['error', 'Could not update tags.'],
      ['info', 'Still starting "api"…']
    ])
    expect(toastStore.getState().toasts[2]?.detail).toBe('one line')
  })
})
