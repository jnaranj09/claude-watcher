import { describe, it, expect, vi } from 'vitest'
import { buildPastSessionRecord, applyRemovalReason } from './pastSessionRecord'
import { PastSessionSchema } from '../../shared/schemas/pastSession'
import type { Session } from '../../shared/schemas/session'

const session: Session = {
  id: 'sess-1',
  status: 'WaitingForInput',
  projectPath: '/home/op/api',
  pid: 9,
  sessionName: 'billing api',
  workspaceId: 'w1',
  tagIds: ['t1', 't2'],
  templateId: 'tpl',
  launchedAt: 100,
  latestMessage: 'never copied',
  pendingToolInput: 'never copied'
}

describe('buildPastSessionRecord', () => {
  it('projects STATE only, keyed by the session id, with the launch and end times', () => {
    const record = buildPastSessionRecord(session, 500)
    expect(record).toEqual({
      id: 'sess-1',
      name: 'billing api',
      cwd: '/home/op/api',
      workspaceId: 'w1',
      tagIds: ['t1', 't2'],
      launchedAt: 100,
      endedAt: 500
    })
    // The strict schema is the guarantee that nothing else rode along.
    expect(PastSessionSchema.safeParse(record).success).toBe(true)
  })
  it('falls back to endedAt when the session carries no launchedAt (an older card)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { launchedAt: _drop, ...noLaunch } = session
    expect(buildPastSessionRecord(noLaunch, 500).launchedAt).toBe(500)
  })
  it('D-8: a card re-keyed by /clear (adoptCard spreads the stored session) keeps its launch time', () => {
    const rebound: Session = { ...session, id: 'sess-2' }
    expect(buildPastSessionRecord(rebound, 600)).toMatchObject({ id: 'sess-2', launchedAt: 100 })
  })
})

describe('applyRemovalReason', () => {
  it('archive with a card writes the record built by buildPastSessionRecord, and never removes', () => {
    const store = { archive: vi.fn(), remove: vi.fn() }
    applyRemovalReason('archive', session.id, session, store, 500)
    expect(store.archive).toHaveBeenCalledWith(buildPastSessionRecord(session, 500))
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('archive with no card (a late SessionEnd for an already-gone id) does nothing', () => {
    const store = { archive: vi.fn(), remove: vi.fn() }
    applyRemovalReason('archive', session.id, undefined, store, 500)
    expect(store.archive).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('delete removes the id and writes no record', () => {
    const store = { archive: vi.fn(), remove: vi.fn() }
    applyRemovalReason('delete', session.id, session, store, 500)
    expect(store.remove).toHaveBeenCalledWith(session.id)
    expect(store.archive).not.toHaveBeenCalled()
  })

  it('a null store is a no-op for either reason', () => {
    expect(() => applyRemovalReason('archive', session.id, session, null, 500)).not.toThrow()
    expect(() => applyRemovalReason('delete', session.id, session, null, 500)).not.toThrow()
  })
})
