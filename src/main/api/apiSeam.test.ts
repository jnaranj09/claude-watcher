// Programmatic API — the per-window seam's event hub.
//
// What these tests protect: the hub fans ONE enriched delta out to every open SSE stream, so
// (a) every subscriber gets it and an unsubscribed one stops getting it (a stream that outlives
// its client would otherwise write to a dead socket forever), (b) one subscriber throwing never
// starves the others (never-crash past the boundary), and (c) the throw is logged by CODE only
// — a delta carries `projectPath` and a session name.
import { describe, it, expect, vi } from 'vitest'
import { createApiEventHub } from './apiSeam'

const removed = { type: 'session.removed' as const, id: 's1', sessionName: 'n', projectPath: '/w' }

describe('createApiEventHub', () => {
  it('delivers to every subscriber and stops after unsubscribe', () => {
    const hub = createApiEventHub()
    const a = vi.fn()
    const b = vi.fn()
    const offA = hub.onEvent(a)
    hub.onEvent(b)
    hub.emit(removed)
    offA()
    hub.emit(removed)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('a throwing subscriber is logged by code and never stops the others', () => {
    const log = vi.fn()
    const hub = createApiEventHub(log)
    hub.onEvent(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    hub.onEvent(ok)
    hub.emit(removed)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][api] code=subscriber_threw')
  })

  it('clear() drops every subscriber', () => {
    const hub = createApiEventHub()
    const a = vi.fn()
    hub.onEvent(a)
    hub.clear()
    hub.emit(removed)
    expect(a).not.toHaveBeenCalled()
  })
})
