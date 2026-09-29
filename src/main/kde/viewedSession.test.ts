// UX-13 — the operator is looking at a session only when the window has focus AND the focused
// view shows a terminal bound to that session right now.
import { describe, it, expect } from 'vitest'
import { isViewingSession, type ViewedSessionDeps } from './viewedSession'

const ID = 'eeee1111-0000-4000-8000-000000000001'

function deps(over: Partial<ViewedSessionDeps> = {}): ViewedSessionDeps {
  return {
    windowFocused: () => true,
    focusedTerminalId: () => 't-1',
    sessionIdFor: (t) => (t === 't-1' ? ID : null),
    ...over
  }
}

describe('isViewingSession (UX-13)', () => {
  it('focused window + the focused view on this session → viewing', () => {
    expect(isViewingSession(ID, deps())).toBe(true)
  })

  it('an unfocused (or minimized) window → not viewing', () => {
    expect(isViewingSession(ID, deps({ windowFocused: () => false }))).toBe(false)
  })

  it('the board view (no focused terminal) → not viewing', () => {
    expect(isViewingSession(ID, deps({ focusedTerminalId: () => null }))).toBe(false)
  })

  it('another session in the focused view → not viewing', () => {
    expect(isViewingSession('other-id', deps())).toBe(false)
  })

  it('a terminal whose binding is gone (the session exited) → not viewing', () => {
    expect(isViewingSession(ID, deps({ sessionIdFor: () => null }))).toBe(false)
  })
})
