import { describe, it, expect, vi } from 'vitest'
import { createReducer, type SessionDelta } from '../c9watch/reducer'
import { createPendingTitles } from './pendingTitles'
import { renameLaunched, type RenameLaunchedDeps } from './renameLaunched'
import { launchedSession } from '../../__fixtures__/fakeSessions'

const ID = 'launch01-0000-4000-8000-0000000000aa'

function setup(): RenameLaunchedDeps & {
  reducer: ReturnType<typeof createReducer>
  pendingTitles: ReturnType<typeof createPendingTitles>
  shipped: SessionDelta[]
} {
  const reducer = createReducer({ now: () => 1 })
  const pendingTitles = createPendingTitles()
  const shipped: SessionDelta[] = []
  const handleDelta = vi.fn((d: SessionDelta) => shipped.push(d))
  return { reducer, pendingTitles, handleDelta, shipped }
}

describe('renameLaunched (session-naming A2 + name-sync)', () => {
  it('renames the card, ships the delta and queues the push for claude', () => {
    const deps = setup()
    deps.reducer.upsertLaunched(launchedSession(ID, { sessionName: 'old' }))

    renameLaunched(deps, ID, 'new')

    expect(deps.shipped).toHaveLength(1)
    expect(deps.reducer.snapshotMap().get(ID)?.sessionName).toBe('new')
    expect(deps.reducer.snapshotMap().get(ID)?.nameSyncPending).toBe(true)
    expect(deps.pendingTitles.take(ID)).toBe('new')
  })

  // R17: a rename that lands just as `/clear` re-keyed the card names an id the reducer no
  // longer holds. Queuing it anyway parks a push under a dead id forever: nothing takes it, and
  // the card (under its new id) never shows the ⟳ mark for a rename that will never happen.
  it('queues NOTHING when the card is gone (unknown id, e.g. a /clear re-key)', () => {
    const deps = setup()

    renameLaunched(deps, 'gone-id', 'new')

    expect(deps.shipped).toHaveLength(0)
    expect(deps.pendingTitles.has('gone-id')).toBe(false)
    expect(deps.pendingTitles.size()).toBe(0)
  })
})
