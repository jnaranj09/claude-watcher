// enrichDelta behaviours the mutation run (StrykerJS) showed no test pinned: with no log
// injected, a dropped delta writes its path and code to console.warn; a nested path is dotted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { enrichDelta } from './enrichDelta'
import { launchedSession } from '../../__fixtures__/fakeSessions'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('enrichDelta — the default log', () => {
  it('writes the path and code of a dropped delta to console.warn when no log is injected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tracker = { columnOf: () => undefined, enteredColumnAt: () => undefined }
    const delta = {
      epoch: 0,
      event: {
        type: 'session.updated' as const,
        id: 's1',
        sessionName: 'n',
        projectPath: '/p',
        status: 'Working'
      }
    }
    enrichDelta(delta, tracker, new Map())
    expect(warn).toHaveBeenCalledWith(
      '[c9watch][feed] dropped delta path=column code=invalid_value'
    )
  })
})

describe('enrichDelta — the logged path', () => {
  it('joins a nested issue path with dots', () => {
    const log = vi.fn()
    const tracker = { columnOf: () => 'working' as const, enteredColumnAt: () => 1 }
    const delta = {
      epoch: 0,
      event: {
        type: 'session.updated' as const,
        id: 's1',
        sessionName: 'n',
        projectPath: '/p',
        status: 'Working'
      }
    }
    const sessions = new Map([['s1', launchedSession('s1', { tagIds: [''] })]])
    enrichDelta(delta, tracker, sessions, log)
    expect(log).toHaveBeenCalledWith({ path: 'tagIds.0', code: 'too_small' })
  })
})
