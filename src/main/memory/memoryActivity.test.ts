// The per-session record of what memory was injected, pulled and saved (spec 2026-11-11 memory).
import { describe, expect, it, vi } from 'vitest'
import type { MemoryActivity } from '../../shared/schemas/memory'
import { createMemoryActivity } from './memoryActivity'

const entry = (n: number): MemoryActivity['entries'][number] => ({
  at: n,
  action: 'pulled',
  tool: 'memory_get',
  itemId: `item-${n}`,
  reason: null
})

describe('memory activity', () => {
  it('an unknown session has nothing injected and no entries', () => {
    expect(createMemoryActivity().get('nope')).toEqual({ injected: null, entries: [] })
  })

  it('6,000 injected characters read back as 1,500 tokens', () => {
    const log = createMemoryActivity()
    log.injected('s1', { chars: 6000, itemIds: ['a', 'b'] })
    expect(log.get('s1').injected).toEqual({ tokens: 1500, itemIds: ['a', 'b'] })
  })

  it('a character count that is not a multiple of 4 rounds the tokens up', () => {
    const log = createMemoryActivity()
    log.injected('s1', { chars: 5, itemIds: [] })
    expect(log.get('s1').injected?.tokens).toBe(2)
  })

  it('entries come back oldest first', () => {
    const log = createMemoryActivity()
    log.record('s1', entry(1))
    log.record('s1', entry(2))
    expect(log.get('s1').entries.map((e) => e.at)).toEqual([1, 2])
  })

  it('the 201st entry drops the oldest', () => {
    const log = createMemoryActivity()
    for (let i = 1; i <= 201; i++) log.record('s1', entry(i))
    const entries = log.get('s1').entries
    expect([entries.length, entries[0]?.at, entries[199]?.at]).toEqual([200, 2, 201])
  })

  it('a caller changing what get returned does not change the record', () => {
    const log = createMemoryActivity()
    log.record('s1', entry(1))
    log.get('s1').entries.pop()
    expect(log.get('s1').entries).toHaveLength(1)
  })

  it('rebind moves the record to the new session id', () => {
    const log = createMemoryActivity()
    log.injected('old', { chars: 8, itemIds: ['a'] })
    log.record('old', entry(1))
    log.rebind('old', 'new')
    expect([log.get('old'), log.get('new')]).toEqual([
      { injected: null, entries: [] },
      { injected: { tokens: 2, itemIds: ['a'] }, entries: [entry(1)] }
    ])
  })

  it('rebind of an unknown session leaves the target alone', () => {
    const log = createMemoryActivity()
    log.record('new', entry(1))
    log.rebind('ghost', 'new')
    expect(log.get('new').entries).toEqual([entry(1)])
  })

  it('forget empties the record', () => {
    const log = createMemoryActivity()
    log.injected('s1', { chars: 8, itemIds: ['a'] })
    log.record('s1', entry(1))
    log.forget('s1')
    expect(log.get('s1')).toEqual({ injected: null, entries: [] })
  })

  it('tells its listeners of an index sent, an entry, a rebind and a forget', () => {
    const log = createMemoryActivity()
    const listener = vi.fn()
    log.onChange(listener)
    log.injected('s1', { chars: 8, itemIds: ['a'] })
    log.record('s1', entry(1))
    log.rebind('s1', 's2')
    log.forget('s2')
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('a read, a rebind of an unknown session and a forget of one tell nobody', () => {
    const log = createMemoryActivity()
    const listener = vi.fn()
    log.onChange(listener)
    log.get('s1')
    log.rebind('ghost', 'new')
    log.forget('ghost')
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops telling a listener after it unsubscribes', () => {
    const log = createMemoryActivity()
    const listener = vi.fn()
    log.onChange(listener)()
    log.record('s1', entry(1))
    expect(listener).not.toHaveBeenCalled()
  })

  it('a listener that throws is logged by code and the entry stands', () => {
    const lines: string[] = []
    const log = createMemoryActivity((line) => lines.push(line))
    log.onChange(() => {
      throw new Error('secret text')
    })
    log.record('s1', entry(1))
    expect(log.get('s1').entries).toEqual([entry(1)])
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_activity_listener_failed'])
  })
})
