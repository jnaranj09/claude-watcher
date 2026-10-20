import { describe, it, expect, vi } from 'vitest'
import { buildPastSessionRecord, applyRemovalReason, pastTasksMarkDone } from './pastSessionRecord'
import { createPastSessionsStore } from './pastSessions'
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
  pendingToolInput: 'never copied',
  pendingToolDetail: 'never copied'
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

describe('tasksMarkDone flag', () => {
  it('archiving a session that could mark tasks done stores the flag', () => {
    const store = { archive: vi.fn(), remove: vi.fn() }
    applyRemovalReason('archive', session.id, session, store, 500, (id) => id === 'sess-1')
    const record = store.archive.mock.calls[0]?.[0] as ReturnType<typeof buildPastSessionRecord>
    expect(record.tasksMarkDone).toBe(true)
    expect(PastSessionSchema.safeParse(record).success).toBe(true)
  })
  it('a session that could not leaves the key out; a delete never asks', () => {
    const store = { archive: vi.fn(), remove: vi.fn() }
    const ask = vi.fn(() => true)
    applyRemovalReason('archive', session.id, session, store, 500)
    expect(store.archive.mock.calls[0]?.[0]).not.toHaveProperty('tasksMarkDone')
    applyRemovalReason('delete', session.id, session, store, 500, ask)
    expect(ask).not.toHaveBeenCalled()
  })
  it('the lookup reads the stored flag; no store or record is off', () => {
    const rec = buildPastSessionRecord(session, 500, true)
    const store = { get: (id: string) => (id === 'sess-1' ? rec : null) }
    expect(pastTasksMarkDone(store, 'sess-1')).toBe(true)
    expect(pastTasksMarkDone(store, 'other')).toBe(false)
    expect(pastTasksMarkDone(null, 'sess-1')).toBe(false)
  })
})

describe('through the real past-sessions store', () => {
  it('archive of a markDone session -> get().tasksMarkDone -> the lookup answers true', () => {
    const store = createPastSessionsStore()
    applyRemovalReason('archive', session.id, session, store, 500, (id) => id === 'sess-1')
    expect(store.get('sess-1')?.tasksMarkDone).toBe(true)
    expect(pastTasksMarkDone(store, 'sess-1')).toBe(true)
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
