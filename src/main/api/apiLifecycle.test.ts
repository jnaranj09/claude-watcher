// Programmatic API — the listener lifecycle driven by the settings store.
//
// What these tests protect: the operator flips `apiEnabled` / `apiPort` in Settings and expects
// the listener to follow EXACTLY — start once, never restart on a no-op patch (every unrelated
// settings patch calls `apply` too, and a restart drops every open SSE stream), restart when the
// port moves, and stop when it is turned off. They also pin the two never-crash paths: a `start`
// that throws and a `close` that throws must be CONTAINED and logged as a code, leaving the
// lifecycle in a state the next `apply` recovers from — main's settings-patch handler and the
// quit path both call straight into here. And `port()` reports the BOUND port (what `onListening`
// reported), never the requested one: Task 16 feeds the OpenAPI `servers[0].url` from it, and a
// port we asked for but never got would advertise a listener that is not there.
import { describe, it, expect } from 'vitest'
import { createApiLifecycle, type ApiLifecycle } from './apiLifecycle'

type StartImpl = (port: number, onListening: (port: number) => void) => { close(): void }

interface Harness {
  lc: ApiLifecycle
  /** Requested ports, in call order. */
  starts: number[]
  /** Ports whose handle was closed, in call order (default impl only). */
  closes: number[]
  logs: string[]
}

/** A fake listener factory. The default impl reports its bind synchronously and records closes. */
function harness(startImpl?: StartImpl): Harness {
  const starts: number[] = []
  const closes: number[] = []
  const logs: string[] = []
  const impl: StartImpl =
    startImpl ??
    ((port, onListening) => {
      onListening(port)
      return { close: () => void closes.push(port) }
    })
  const start: StartImpl = (port, onListening) => {
    starts.push(port)
    return impl(port, onListening)
  }
  return {
    lc: createApiLifecycle({ start, log: (m) => void logs.push(m) }),
    starts,
    closes,
    logs
  }
}

describe('createApiLifecycle', () => {
  it('disabled → nothing starts', () => {
    const { lc, starts } = harness()

    lc.apply({ apiEnabled: false, apiPort: 9280 })

    expect(starts).toEqual([])
    expect(lc.port()).toBeNull()
  })

  it('enabled → starts once; a repeated apply with the same port does nothing', () => {
    const { lc, starts } = harness()

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    lc.apply({ apiEnabled: true, apiPort: 9280 })

    expect(starts).toEqual([9280])
    expect(lc.port()).toBe(9280)
  })

  it('a port change restarts; disabling stops', () => {
    const { lc, starts, closes } = harness()

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    lc.apply({ apiEnabled: true, apiPort: 9300 })

    expect(starts).toEqual([9280, 9300])
    expect(closes).toEqual([9280])

    lc.apply({ apiEnabled: false, apiPort: 9300 })

    expect(closes).toEqual([9280, 9300])
    expect(lc.port()).toBeNull()
  })

  it('re-enabling after a stop starts again on the same port', () => {
    const { lc, starts } = harness()

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    lc.apply({ apiEnabled: false, apiPort: 9280 })
    lc.apply({ apiEnabled: true, apiPort: 9280 })

    expect(starts).toEqual([9280, 9280])
    expect(lc.port()).toBe(9280)
  })

  it('stop() is idempotent', () => {
    const { lc, closes, logs } = harness()

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    lc.stop()
    lc.stop()

    expect(closes).toEqual([9280])
    // The second stop is a no-op all the way down — no second close, and no second log line.
    expect(logs.filter((l) => l.includes('code=stopped'))).toHaveLength(1)
    expect(lc.port()).toBeNull()
  })

  it('apply() while disabled and not running closes nothing and logs nothing', () => {
    const { lc, closes, logs } = harness()

    lc.apply({ apiEnabled: false, apiPort: 9280 })
    lc.apply({ apiEnabled: false, apiPort: 9300 })

    expect(closes).toEqual([])
    expect(logs).toEqual([])
  })

  it('port() is null until the listen reports, then reports the BOUND port', () => {
    const reports: Array<(port: number) => void> = []
    const { lc } = harness((port, onListening) => {
      expect(port).toBe(9280)
      reports.push(onListening)
      return { close: () => {} }
    })

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    expect(lc.port()).toBeNull()
    expect(reports).toHaveLength(1)

    reports[0]?.(9281)

    expect(lc.port()).toBe(9281)
  })

  it('a bind that reports AFTER a stop neither resurrects port() nor logs', () => {
    const reports: Array<(port: number) => void> = []
    const { lc, logs } = harness((_port, onListening) => {
      reports.push(onListening)
      return { close: () => {} }
    })

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    lc.stop()
    reports[0]?.(9280)

    expect(lc.port()).toBeNull()
    expect(logs).toEqual(['[claude-watcher][api] code=stopped'])
  })

  it('a listen that never reports leaves port() null, and the handle is still closed on disable', () => {
    const closed: number[] = []
    const { lc } = harness((port) => ({ close: () => void closed.push(port) }))

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    expect(lc.port()).toBeNull()

    lc.apply({ apiEnabled: false, apiPort: 9280 })

    expect(closed).toEqual([9280])
  })

  it('logs a code line for the bind and for the stop, and nothing else', () => {
    const { lc, logs } = harness()

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    lc.apply({ apiEnabled: false, apiPort: 9280 })

    expect(logs).toEqual([
      '[claude-watcher][api] code=listening port=9280',
      '[claude-watcher][api] code=stopped'
    ])
  })

  it('a start that throws is contained and logged, and the next apply retries', () => {
    let fail = true
    const { lc, starts, logs } = harness(() => {
      if (fail) throw new Error('EADDRINUSE')
      return { close: () => {} }
    })

    expect(() => lc.apply({ apiEnabled: true, apiPort: 9280 })).not.toThrow()
    expect(lc.port()).toBeNull()
    expect(logs).toEqual(['[claude-watcher][api] code=listen_failed'])

    fail = false
    lc.apply({ apiEnabled: true, apiPort: 9280 })

    expect(starts).toEqual([9280, 9280])
    expect(lc.port()).toBeNull()
  })

  it('never logs the thrown error, only the code', () => {
    const { lc, logs } = harness(() => {
      throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:9280')
    })

    lc.apply({ apiEnabled: true, apiPort: 9280 })

    expect(logs).toEqual(['[claude-watcher][api] code=listen_failed'])
    expect(logs.join('\n')).not.toMatch(/EADDRINUSE|address already in use/)
  })

  it('a close that throws is contained: the restart still starts the new port', () => {
    const { lc, starts, logs } = harness((port) => ({
      close: () => {
        if (port === 9280) throw new Error('close failed')
      }
    }))

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    expect(() => lc.apply({ apiEnabled: true, apiPort: 9300 })).not.toThrow()

    expect(starts).toEqual([9280, 9300])
    expect(logs).toContain('[claude-watcher][api] code=close_failed')
  })

  it('a close that throws still leaves the lifecycle stopped', () => {
    const { lc, starts } = harness(() => ({
      close: () => {
        throw new Error('close failed')
      }
    }))

    lc.apply({ apiEnabled: true, apiPort: 9280 })
    expect(() => lc.stop()).not.toThrow()
    expect(lc.port()).toBeNull()

    // Still stopped, so the next enable starts rather than short-circuiting on a stale entry.
    lc.apply({ apiEnabled: true, apiPort: 9280 })

    expect(starts).toEqual([9280, 9280])
  })
})
