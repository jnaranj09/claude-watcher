// Hook-status feature — unit tests for the hookStatus event-OBJECT mapper.
//
// Runs under the `main-unit` Vitest project (node).
// Covers the full Phase-2 mapping table: the Notification permission_prompt vs
// idle_prompt split, the PreToolUse(AskUserQuestion) special-case, the Stop
// prose-question branch (both ways + absent message), SessionEnd → removed, and
// unknown events → null. [spec Tasks; spec I/O & Edge-Case Matrix; plan L1.3/L2.7]

import { describe, it, expect } from 'vitest'
import { hookStatus } from './hookStatus'
import type { HookEvent } from '../../shared/schemas/hookEvent'

// Build a HookEvent-shaped object (the schema's inferred type) for the mapper.
const evt = (over: Partial<HookEvent> & Pick<HookEvent, 'hook_event_name'>): HookEvent => ({
  session_id: 'sess-1',
  ...over
})

describe('hookStatus — event-object to HookStatusChange mapper', () => {
  // --- Notification: permission_prompt vs everything else ---
  it('Notification(permission_prompt) → NeedsPermission', () => {
    expect(
      hookStatus(evt({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }))
    ).toEqual({ kind: 'status', status: 'NeedsPermission' })
  })

  it('Notification(idle_prompt) → null (Stop owns idle)', () => {
    expect(
      hookStatus(evt({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }))
    ).toBeNull()
  })

  it('Notification with another / absent notification_type → null', () => {
    expect(
      hookStatus(evt({ hook_event_name: 'Notification', notification_type: 'something_new' }))
    ).toBeNull()
    expect(hookStatus(evt({ hook_event_name: 'Notification' }))).toBeNull()
  })

  // --- PreToolUse: AskUserQuestion special-case vs every other tool ---
  it('PreToolUse(AskUserQuestion) → NeedsAttention', () => {
    expect(
      hookStatus(evt({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }))
    ).toEqual({ kind: 'status', status: 'NeedsAttention' })
  })

  it('PreToolUse(other tool) → Working', () => {
    expect(hookStatus(evt({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }))).toEqual({
      kind: 'status',
      status: 'Working'
    })
    expect(hookStatus(evt({ hook_event_name: 'PreToolUse' }))).toEqual({
      kind: 'status',
      status: 'Working'
    })
  })

  // --- Plain active events → Working ---
  it.each(['UserPromptSubmit', 'PostToolUse', 'SessionStart'] as const)('%s → Working', (name) => {
    expect(hookStatus(evt({ hook_event_name: name }))).toEqual({
      kind: 'status',
      status: 'Working'
    })
  })

  // --- Stop: prose-question branch BOTH ways ---
  it('Stop with message ending in "?" → NeedsAttention', () => {
    expect(
      hookStatus(
        evt({ hook_event_name: 'Stop', last_assistant_message: 'Which option do you prefer?' })
      )
    ).toEqual({ kind: 'status', status: 'NeedsAttention' })
  })

  it('Stop with a plain (non-question) message → WaitingForInput', () => {
    expect(
      hookStatus(evt({ hook_event_name: 'Stop', last_assistant_message: 'All done.' }))
    ).toEqual({ kind: 'status', status: 'WaitingForInput' })
  })

  it('Stop with no last_assistant_message → WaitingForInput (safe idle default)', () => {
    expect(hookStatus(evt({ hook_event_name: 'Stop' }))).toEqual({
      kind: 'status',
      status: 'WaitingForInput'
    })
  })

  // --- SessionEnd → removed ---
  it('SessionEnd → { kind: "removed" }', () => {
    expect(hookStatus(evt({ hook_event_name: 'SessionEnd' }))).toEqual({ kind: 'removed' })
  })

  // --- Unknown event → null (never fail-closed) ---
  it('unknown event names → null (future events pass, never fail-closed)', () => {
    expect(hookStatus(evt({ hook_event_name: 'UnknownEvent' }))).toBeNull()
    expect(hookStatus(evt({ hook_event_name: '' }))).toBeNull()
    expect(hookStatus(evt({ hook_event_name: 'SomeNewClaudeEvent' }))).toBeNull()
  })

  it('is a pure function — repeated calls return equal results', () => {
    const stopQ = evt({ hook_event_name: 'Stop', last_assistant_message: 'Ready?' })
    expect(hookStatus(stopQ)).toEqual({ kind: 'status', status: 'NeedsAttention' })
    expect(hookStatus(stopQ)).toEqual({ kind: 'status', status: 'NeedsAttention' })
    expect(hookStatus(evt({ hook_event_name: 'SessionEnd' }))).toEqual({ kind: 'removed' })
  })
})
