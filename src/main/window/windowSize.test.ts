import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  initialWindowSize,
  trackWindowSize,
  type TrackedWindow
} from './windowSize'
import type { WindowSize } from '../../shared/schemas/settings'

type Ev = 'resize' | 'maximize' | 'unmaximize' | 'closed'

function fakeWindow(): TrackedWindow & {
  emit(e: Ev): void
  bounds: { width: number; height: number }
  minimized: boolean
  maximized: boolean
  destroyed: boolean
} {
  const listeners = new Map<Ev, Array<() => void>>()
  const w = {
    bounds: { width: 1200, height: 800 },
    minimized: false,
    maximized: false,
    destroyed: false,
    on(event: Ev, l: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), l])
      return w
    },
    emit(e: Ev) {
      for (const l of listeners.get(e) ?? []) l()
    },
    isMinimized: () => w.minimized,
    isMaximized: () => w.maximized,
    isDestroyed: () => w.destroyed,
    getNormalBounds: () => w.bounds
  }
  return w
}

describe('initialWindowSize', () => {
  it('uses the built-in size when nothing is saved', () => {
    expect(initialWindowSize(null)).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    })
  })

  it('uses the saved size', () => {
    expect(initialWindowSize({ width: 1400, height: 900, maximized: true })).toEqual({
      width: 1400,
      height: 900
    })
  })
})

describe('trackWindowSize', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves once after resizing goes quiet', () => {
    const w = fakeWindow()
    const saves: WindowSize[] = []
    trackWindowSize(w, (s) => saves.push(s), 500)
    w.emit('resize')
    vi.advanceTimersByTime(300)
    w.bounds = { width: 1300, height: 850 }
    w.emit('resize')
    vi.advanceTimersByTime(499)
    expect(saves).toEqual([])
    vi.advanceTimersByTime(1)
    expect(saves).toEqual([{ width: 1300, height: 850, maximized: false }])
  })

  it('saves the maximized state with the normal bounds', () => {
    const w = fakeWindow()
    const saves: WindowSize[] = []
    trackWindowSize(w, (s) => saves.push(s), 500)
    w.maximized = true
    w.emit('maximize')
    vi.advanceTimersByTime(500)
    expect(saves).toEqual([{ width: 1200, height: 800, maximized: true }])
  })

  it('does not save while minimized, or after the window closed', () => {
    const w = fakeWindow()
    const saves: WindowSize[] = []
    trackWindowSize(w, (s) => saves.push(s), 500)
    w.minimized = true
    w.emit('resize')
    vi.advanceTimersByTime(500)
    w.minimized = false
    w.emit('resize')
    w.emit('closed')
    vi.advanceTimersByTime(500)
    expect(saves).toEqual([])
  })

  it('clamps a size the settings file would refuse', () => {
    const w = fakeWindow()
    const saves: WindowSize[] = []
    trackWindowSize(w, (s) => saves.push(s), 500)
    w.bounds = { width: 50, height: 99999.6 }
    w.emit('resize')
    vi.advanceTimersByTime(500)
    expect(saves).toEqual([{ width: 200, height: 16384, maximized: false }])
  })
})
