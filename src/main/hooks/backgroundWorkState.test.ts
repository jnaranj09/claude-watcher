// The per-session memory of claude's LAST background-work report.
//
// WHY IT HAS TO EXIST. `background_tasks` rides `Stop` ONLY — probe-verified on claude
// 2.1.250: `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Notification` all arrive
// without it. So at the moment the operator presses Esc — which fires NO hook at all —
// the app has no live answer to "is a shell still running?" unless it remembered the last
// one. Without that memory the Esc handler demotes the card to idle while a background
// build keeps running, which is the exact false-idle this whole feature exists to prevent.
import { describe, it, expect } from 'vitest'
import { createBackgroundWorkState } from './backgroundWorkState'
import type { HookEvent } from '../../shared/schemas/hookEvent'

/** A hook event; `background_tasks` is omitted unless a test supplies it. */
function evt(name: string, background_tasks?: unknown): HookEvent {
  const base = { session_id: 's1', hook_event_name: name }
  return (background_tasks === undefined
    ? base
    : { ...base, background_tasks }) as unknown as HookEvent
}
const running = [{ id: 't1', type: 'shell', status: 'running' }]

describe('backgroundWorkState — remembers the last REPORTED background-work verdict', () => {
  it('reports nothing running for a session it has never seen', () => {
    expect(createBackgroundWorkState().isRunning('nobody')).toBe(false)
  })

  it('a Stop carrying a running shell marks the session as having work', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('Stop', running))
    expect(state.isRunning('s1')).toBe(true)
  })

  it('a Stop carrying an empty list marks it as having none', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('Stop', []))
    expect(state.isRunning('s1')).toBe(false)
  })

  it('a later empty Stop CLEARS a previously running verdict', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('Stop', running))
    state.observe('s1', evt('Stop', []))
    expect(state.isRunning('s1')).toBe(false)
  })

  // THE LOAD-BEARING ONE. Mid-turn events do not carry the field. If their absence were
  // read as "nothing running", every PreToolUse after the arming Stop would wipe the
  // verdict and Esc would go back to lying.
  it('an event WITHOUT the field does not clear a running verdict', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('Stop', running))
    state.observe('s1', evt('UserPromptSubmit'))
    state.observe('s1', evt('PreToolUse'))
    state.observe('s1', evt('PostToolUse'))
    expect(state.isRunning('s1')).toBe(true)
  })

  it('an event WITHOUT the field does not invent a verdict either', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('PreToolUse'))
    expect(state.isRunning('s1')).toBe(false)
  })

  // A shape drift must not silently clear the verdict — keeping a stale `Working` costs
  // one wrong card until the next Stop; clearing it wrongly costs a false idle while real
  // work runs, which is the failure this module exists to prevent.
  it('a MALFORMED background_tasks does not clear a running verdict', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('Stop', running))
    state.observe('s1', evt('Stop', 'not-an-array'))
    expect(state.isRunning('s1')).toBe(true)
  })

  it('forget drops the session', () => {
    const state = createBackgroundWorkState()
    state.observe('s1', evt('Stop', running))
    state.forget('s1')
    expect(state.isRunning('s1')).toBe(false)
  })

  it('sessions are independent', () => {
    const state = createBackgroundWorkState()
    state.observe('a', evt('Stop', running))
    state.observe('b', evt('Stop', []))
    expect(state.isRunning('a')).toBe(true)
    expect(state.isRunning('b')).toBe(false)
  })
})
