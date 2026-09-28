import { describe, expect, it } from 'vitest'
import { createLivePastSessions, LIVE_RECORD_REFRESH_MS } from './livePastSessions'
import { createPastSessionsStore } from './pastSessions'
import type { Session } from '../../shared/schemas/session'
import type { PastSession } from '../../shared/schemas/pastSession'

const SESSION = {
  id: 'sess-1',
  sessionName: 'billing api',
  projectPath: '/home/op/api',
  workspaceId: 'default',
  tagIds: [],
  launchedAt: 100
} as unknown as Session

function harness(): {
  live: ReturnType<typeof createLivePastSessions>
  store: ReturnType<typeof createPastSessionsStore>
  writes: PastSession[]
  clock: { t: number }
} {
  const store = createPastSessionsStore()
  const writes: PastSession[] = []
  const clock = { t: 1_000 }
  const live = createLivePastSessions({
    store: () => ({
      markLive: (r) => {
        writes.push(r)
        store.markLive(r)
      },
      dropLive: (id) => store.dropLive(id)
    }),
    now: () => clock.t
  })
  return { live, store, writes, clock }
}

describe('createLivePastSessions (UX-01)', () => {
  it('a card on the board has a live record — hidden from the dialog', () => {
    const { live, store } = harness()
    live.onSession(SESSION)
    expect(store.get('sess-1')).toMatchObject({ id: 'sess-1', live: true, endedAt: 1_000 })
    expect(store.list()).toEqual([])
  })

  it('writes only on a real change, or once the end time is a minute stale', () => {
    const { live, writes, clock } = harness()
    live.onSession(SESSION)
    clock.t += 5_000
    live.onSession(SESSION) // a status change: nothing the record holds
    expect(writes).toHaveLength(1)
    live.onSession({ ...SESSION, sessionName: 'renamed' })
    expect(writes).toHaveLength(2)
    clock.t += LIVE_RECORD_REFRESH_MS
    live.onSession({ ...SESSION, sessionName: 'renamed' })
    expect(writes).toHaveLength(3)
  })

  it('a new transcript path is written at once, a repeated one is not', () => {
    const { live, store, writes } = harness()
    live.onSession(SESSION)
    live.notePath(SESSION, '/t/sess-1.jsonl')
    live.notePath(SESSION, '/t/sess-1.jsonl')
    expect(writes).toHaveLength(2)
    expect(store.get('sess-1')?.transcriptPath).toBe('/t/sess-1.jsonl')
  })

  it('an archive before the removal keeps the record; the removal then drops nothing', () => {
    const { live, store } = harness()
    live.notePath(SESSION, '/t/sess-1.jsonl')
    // What removeLaunchedSession's archive writes: built from the card, no path, no live mark.
    store.archive({
      id: 'sess-1',
      name: 'billing api',
      cwd: '/home/op/api',
      workspaceId: 'default',
      tagIds: [],
      launchedAt: 100,
      endedAt: 2_000
    })
    live.onRemoved('sess-1')
    expect(store.list().map((r) => r.id)).toEqual(['sess-1'])
    expect(store.get('sess-1')?.transcriptPath).toBe('/t/sess-1.jsonl')
  })

  it('a /clear rebind: the old id leaves without an archive, so its live record goes', () => {
    const { live, store } = harness()
    live.onSession(SESSION)
    live.onSession({ ...SESSION, id: 'sess-2' })
    live.onRemoved('sess-1')
    expect(store.get('sess-1')).toBeNull()
    expect(store.get('sess-2')?.live).toBe(true)
  })

  it('no store yet: a no-op, never a throw', () => {
    const live = createLivePastSessions({ store: () => null, now: () => 1 })
    expect(() => {
      live.onSession(SESSION)
      live.onRemoved('sess-1')
    }).not.toThrow()
  })
})
