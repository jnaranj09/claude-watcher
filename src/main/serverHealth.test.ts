import { describe, expect, it } from 'vitest'
import type { ServerHealth } from '../shared/schemas/serverHealth'
import { createServerHealth } from './serverHealth'

function harness(): { h: ReturnType<typeof createServerHealth>; pushes: ServerHealth[] } {
  const pushes: ServerHealth[] = []
  const h = createServerHealth({ hookPort: 9279, onChange: (s) => void pushes.push(s) })
  return { h, pushes }
}

describe('createServerHealth', () => {
  it('starts as starting / off and NOT listening', () => {
    const { h, pushes } = harness()
    expect(h.get()).toEqual({ hooks: 'starting', hookPort: 9279, api: 'off' })
    expect(h.hookListening()).toBe(false)
    expect(pushes).toEqual([])
  })

  it('a bind reports ok and listening', () => {
    const { h, pushes } = harness()
    h.hookBound()
    expect(h.hookListening()).toBe(true)
    expect(pushes.map((p) => p.hooks)).toEqual(['ok'])
  })

  it('EADDRINUSE is port_in_use and NOT listening (SEC-6 reads this)', () => {
    const { h, pushes } = harness()
    h.hookFailed('EADDRINUSE')
    expect(h.hookListening()).toBe(false)
    expect(pushes.map((p) => p.hooks)).toEqual(['port_in_use'])
  })

  it('any other bind error is server_error', () => {
    const { h } = harness()
    h.hookFailed('EACCES')
    expect(h.get().hooks).toBe('server_error')
  })

  it('an error AFTER the bind also stops the gate (fail closed)', () => {
    const { h } = harness()
    h.hookBound()
    h.hookFailed('ECONNRESET')
    expect(h.hookListening()).toBe(false)
  })

  it('a failed settings write shows only while listening, and clears on the next good write', () => {
    const { h, pushes } = harness()
    h.hookBound()
    h.hookSettingsWritten(false)
    h.hookSettingsWritten(true)
    expect(pushes.map((p) => p.hooks)).toEqual(['ok', 'hooks_file_failed', 'ok'])
  })

  it('a port in use wins over a failed settings write', () => {
    const { h } = harness()
    h.hookFailed('EADDRINUSE')
    h.hookSettingsWritten(false)
    expect(h.get().hooks).toBe('port_in_use')
  })

  it('a close resets to starting, so a new window binds from scratch', () => {
    const { h } = harness()
    h.hookFailed('EADDRINUSE')
    h.hookClosed()
    expect(h.get().hooks).toBe('starting')
  })

  it('pushes only on a real change', () => {
    const { h, pushes } = harness()
    h.hookBound()
    h.hookBound()
    h.hookSettingsWritten(true)
    h.setApi('off')
    h.setApi('listening')
    h.setApi('listening')
    expect(pushes).toEqual([
      { hooks: 'ok', hookPort: 9279, api: 'off' },
      { hooks: 'ok', hookPort: 9279, api: 'listening' }
    ])
  })
})
