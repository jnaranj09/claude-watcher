import { describe, it, expect, vi, type Mock } from 'vitest'
import { openPastSession, type PastSessionOpenDeps } from './pastSessionOpen'
import type { PastSession } from '../../shared/schemas/pastSession'
import type { LaunchRequest } from './launchSession'

const RECORD: PastSession = {
  id: 'sess-A',
  name: 'billing api',
  cwd: '/home/op/api',
  workspaceId: 'w1',
  tagIds: ['t-live', 't-gone'],
  launchedAt: 1,
  endedAt: 2
}

function deps(over: Partial<PastSessionOpenDeps> = {}): PastSessionOpenDeps & {
  launch: Mock<(req: LaunchRequest) => { terminalId: string }>
  remove: Mock<(id: string) => void>
} {
  const launch = vi.fn<(req: LaunchRequest) => { terminalId: string }>(() => ({
    terminalId: 'term-9'
  }))
  const remove = vi.fn<(id: string) => void>()
  return {
    get: (id) => (id === RECORD.id ? RECORD : null),
    isDirectory: () => true,
    isLive: () => false,
    tagExists: (id) => id === 't-live',
    ...over,
    // Always the mocks: no test in this file overrides launch/remove, and keeping them last
    // (rather than inside the `over` spread) keeps their type the concrete `Mock<...>` instead
    // of a union with `PastSessionOpenDeps`'s plain function signature.
    launch,
    remove
  }
}

describe('openPastSession', () => {
  it('registers a resume recipe (cwd, name, workspace, surviving tags), removes the record, returns the launch', () => {
    const d = deps()
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({
      ok: true,
      terminalId: 'term-9',
      workspaceId: 'w1',
      name: 'billing api'
    })
    expect(d.launch).toHaveBeenCalledWith({
      cwd: '/home/op/api',
      name: 'billing api',
      workspaceId: 'w1',
      resumeSessionId: 'sess-A',
      tagIds: ['t-live'],
      flags: { model: null, permissionMode: null, effort: null }
    })
    expect(d.remove).toHaveBeenCalledWith('sess-A')
  })
  it('not_found: unknown id, nothing launched, nothing removed', () => {
    const d = deps()
    expect(openPastSession({ id: 'nope' }, d)).toEqual({ ok: false, code: 'not_found' })
    expect(d.launch).not.toHaveBeenCalled()
    expect(d.remove).not.toHaveBeenCalled()
  })
  it('folder_missing: the cwd is gone or not a directory; the record STAYS', () => {
    const d = deps({ isDirectory: () => false })
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({ ok: false, code: 'folder_missing' })
    expect(d.remove).not.toHaveBeenCalled()
  })
  it('already_open: the id is a live card; nothing launched', () => {
    const d = deps({ isLive: (id) => id === 'sess-A' })
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({ ok: false, code: 'already_open' })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('the arg is untrusted: a blank or malformed id throws before anything runs', () => {
    const d = deps()
    expect(() => openPastSession({ id: '' }, d)).toThrow()
    expect(() => openPastSession('sess-A', d)).toThrow()
    expect(d.launch).not.toHaveBeenCalled()
  })
})
