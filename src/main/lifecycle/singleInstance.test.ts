import { describe, expect, it, vi } from 'vitest'
import { claimSingleInstance, type SingleInstanceDeps } from './singleInstance'

type Recorded = SingleInstanceDeps & {
  requestLock: ReturnType<typeof vi.fn<() => boolean>>
  onSecondInstance: ReturnType<typeof vi.fn<(h: () => void) => void>>
  raise: ReturnType<typeof vi.fn<() => void>>
  log: ReturnType<typeof vi.fn<(line: string) => void>>
}

function deps(lock: boolean, smoke = false): { d: Recorded; fire: () => void } {
  let handler: (() => void) | null = null
  const d: Recorded = {
    smoke,
    requestLock: vi.fn<() => boolean>(() => lock),
    onSecondInstance: vi.fn<(h: () => void) => void>((h) => {
      handler = h
    }),
    raise: vi.fn<() => void>(),
    log: vi.fn<(line: string) => void>()
  }
  return { d, fire: () => handler?.() }
}

describe('claimSingleInstance (UX-04)', () => {
  it('the first instance keeps running and raises its window on a second launch', () => {
    const { d, fire } = deps(true)
    expect(claimSingleInstance(d)).toBe(true)
    expect(d.raise).not.toHaveBeenCalled()
    fire()
    expect(d.raise).toHaveBeenCalledTimes(1)
  })

  it('a second instance must quit, and registers nothing', () => {
    const { d } = deps(false)
    expect(claimSingleInstance(d)).toBe(false)
    expect(d.onSecondInstance).not.toHaveBeenCalled()
    expect(d.log).toHaveBeenCalledWith('[claude-watcher][instance] code=already_running')
  })

  it('smoke never takes the lock, so it runs beside the installed app', () => {
    const { d } = deps(false, true)
    expect(claimSingleInstance(d)).toBe(true)
    expect(d.requestLock).not.toHaveBeenCalled()
  })
})
