import { describe, it, expect } from 'vitest'
import { buildPastSessionRecord } from './pastSessionRecord'
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
