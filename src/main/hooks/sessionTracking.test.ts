import { describe, expect, it, vi } from 'vitest'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import { forgetSession, trackHookEvent, type SessionTrackingDeps } from './sessionTracking'

const ID = '11111111-2222-4333-8444-555555555555'

function deps(): SessionTrackingDeps & {
  watch: ReturnType<typeof vi.fn>
  unwatch: ReturnType<typeof vi.fn>
  lines: string[]
} {
  const watch = vi.fn(() => true)
  const unwatch = vi.fn()
  const lines: string[] = []
  return {
    watch,
    unwatch,
    lines,
    watcher: { watch, unwatch },
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line)
  }
}

function stop(sessionId: string, running: boolean): HookEvent {
  return {
    session_id: sessionId,
    hook_event_name: 'Stop',
    transcript_path: '/tmp/t.jsonl',
    background_tasks: running ? [{ id: 'b1', status: 'running' }] : []
  } as HookEvent
}

describe('trackHookEvent', () => {
  it('tails and records a KNOWN session', () => {
    const d = deps()
    trackHookEvent(stop(ID, true), true, d)
    expect(d.watch).toHaveBeenCalledWith(ID, '/tmp/t.jsonl')
    expect(d.lines).toEqual([`[c9watch][hooks] code=transcript_watch session=${ID}`])
  })

  it('an UNKNOWN id grows nothing and logs nothing — not even its id (SEC-2, SEC-3)', () => {
    const d = deps()
    const forged = 'x\n[c9watch][hooks] code=forged'
    trackHookEvent(stop(forged, true), false, d)
    expect(d.watch).not.toHaveBeenCalled()
    expect(d.lines).toEqual([])
  })

  it('a known session with no transcript_path warns by code, no tail', () => {
    const d = deps()
    trackHookEvent({ session_id: ID, hook_event_name: 'UserPromptSubmit' } as HookEvent, true, d)
    expect(d.watch).not.toHaveBeenCalled()
    expect(d.lines).toEqual([`[c9watch][hooks] code=transcript_path_absent session=${ID}`])
  })
})

describe('forgetSession', () => {
  it('stops the tail (R13)', () => {
    const d = deps()
    trackHookEvent(stop(ID, true), true, d)
    forgetSession(ID, d)
    expect(d.unwatch).toHaveBeenCalledWith(ID)
  })
})
