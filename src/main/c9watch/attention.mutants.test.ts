// Attention tracker behaviours the mutation run (StrykerJS) showed no test pinned: it ignores its
// own raised events, the debounce starts only on a leave from needs-you and ends at its bound,
// and a raise with no session in the map is skipped and logged. Injected `now()`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAttentionTracker } from './attention'
import { launchedSession } from '../../__fixtures__/fakeSessions'
import type { SessionDelta } from './reducer'
import type { Session } from '../../shared/schemas/session'

const ID = 'att00001-0000-4000-8000-000000000001'
const DEBOUNCE = 700

function updated(status: string): SessionDelta {
  return {
    epoch: 0,
    event: { type: 'session.updated', id: ID, sessionName: 'proj', projectPath: '/p', status }
  }
}

function sessions(status: string): ReadonlyMap<string, Session> {
  return new Map([[ID, launchedSession(ID, { status })]])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attention tracker — its own raised events', () => {
  it('an attention.raised delta raises nothing and moves no column', () => {
    const tracker = createAttentionTracker({ now: () => 0, debounceMs: DEBOUNCE })
    tracker.onDelta(updated('Working'), sessions('Working'))
    const raised: SessionDelta = {
      epoch: 0,
      event: {
        type: 'attention.raised',
        id: ID,
        sessionName: 'proj',
        projectPath: '/p',
        status: 'NeedsPermission',
        timestamp: 0
      }
    }
    expect(tracker.onDelta(raised, sessions('NeedsPermission'))).toEqual([])
    expect(tracker.columnOf(ID)).toBe('working')
  })
})

describe('attention tracker — the debounce', () => {
  it('a move from working to idle does not start the debounce', () => {
    let t = 0
    const tracker = createAttentionTracker({ now: () => t, debounceMs: DEBOUNCE })
    tracker.onDelta(updated('Working'), sessions('Working'))
    t = 10
    tracker.onDelta(updated('WaitingForInput'), sessions('WaitingForInput'))
    t = 20
    expect(tracker.onDelta(updated('NeedsPermission'), sessions('NeedsPermission'))).toHaveLength(1)
  })

  it('a re-entry exactly one debounce window after leaving needs-you raises', () => {
    let t = 0
    const tracker = createAttentionTracker({ now: () => t, debounceMs: DEBOUNCE })
    tracker.onDelta(updated('Working'), sessions('Working'))
    t = 10
    tracker.onDelta(updated('NeedsPermission'), sessions('NeedsPermission'))
    t = 20
    tracker.onDelta(updated('Working'), sessions('Working'))
    t = 20 + DEBOUNCE
    expect(tracker.onDelta(updated('NeedsPermission'), sessions('NeedsPermission'))).toHaveLength(1)
  })
})

describe('attention tracker — no session in the map', () => {
  it('skips the raise when the map has no session for the id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tracker = createAttentionTracker({ now: () => 0, debounceMs: DEBOUNCE })
    tracker.onDelta(updated('Working'), sessions('Working'))
    expect(tracker.onDelta(updated('NeedsPermission'), new Map())).toEqual([])
  })

  it('logs the id and the session_missing code when the map has no session for the id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tracker = createAttentionTracker({ now: () => 0, debounceMs: DEBOUNCE })
    tracker.onDelta(updated('Working'), sessions('Working'))
    tracker.onDelta(updated('NeedsPermission'), new Map())
    expect(warn).toHaveBeenCalledWith(
      `[c9watch][tracker] no session in map for raise id=${ID} code=session_missing`
    )
  })
})
