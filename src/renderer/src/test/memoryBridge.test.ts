// The Memory dialog's test double follows main's rule for "the items this session saved"
// (`memoryStore.ts`, P3-C29): an item the operator wrote keeps its session id but is not counted
// or removed with the session. jsdom `unit`.
import { afterEach, describe, expect, it } from 'vitest'
import { factItem, installMemoryBridge, specificItem } from './memoryBridge'

const items = (): ReturnType<typeof specificItem>[] => [
  specificItem({ id: 'agent', origin: { by: 'agent', sessionId: 's-1' } }),
  factItem({ id: 'extract', origin: { by: 'extract', sessionId: 's-1' } }),
  specificItem({ id: 'mine', origin: { by: 'operator', sessionId: 's-1' } }),
  factItem({ id: 'other', origin: { by: 'agent', sessionId: 's-2' } })
]

afterEach(() => {
  delete (window as unknown as { memory?: unknown }).memory
})

describe('the memory test double', () => {
  it('the session count leaves out an item the operator wrote', async () => {
    const bridge = installMemoryBridge(items())
    await expect(bridge.sessionCount('s-1')).resolves.toBe(2)
  })

  it('removing a session keeps an item the operator wrote and answers how many went', async () => {
    const bridge = installMemoryBridge(items())
    await expect(bridge.removeSession('s-1')).resolves.toBe(2)
    expect(bridge.items.map((i) => i.id)).toEqual(['mine', 'other'])
  })
})
