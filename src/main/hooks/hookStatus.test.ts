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
    ).toEqual({
      kind: 'status',
      status: 'NeedsAttention',
      toolName: 'AskUserQuestion',
      fromTool: true
    })
  })

  // R14 / R20: a tool event carries its tool's name (a later permission prompt is for it) and is
  // marked as a tool event (it cannot clear an open permission prompt).
  it('PreToolUse(other tool) → Working, naming the tool', () => {
    expect(hookStatus(evt({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }))).toEqual({
      kind: 'status',
      status: 'Working',
      toolName: 'Bash',
      fromTool: true
    })
    expect(hookStatus(evt({ hook_event_name: 'PreToolUse' }))).toEqual({
      kind: 'status',
      status: 'Working',
      fromTool: true
    })
  })

  it('PostToolUse → Working, as a tool event', () => {
    expect(hookStatus(evt({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }))).toEqual({
      kind: 'status',
      status: 'Working',
      fromTool: true
    })
  })

  // --- A prompt is NOT a tool event: it always moves the card ---
  it('UserPromptSubmit → Working', () => {
    expect(hookStatus(evt({ hook_event_name: 'UserPromptSubmit' }))).toEqual({
      kind: 'status',
      status: 'Working'
    })
  })

  // --- SessionStart is NOT claude's turn: booting/resuming lands at the prompt, idle ---
  it('SessionStart → WaitingForInput (booting is not working)', () => {
    expect(hookStatus(evt({ hook_event_name: 'SessionStart' }))).toEqual({
      kind: 'status',
      status: 'WaitingForInput'
    })
  })

  // R19: an auto-compact restarts claude's context MID-TURN; it must not drop the card to idle.
  // The other sources (and a future one) still mean "at the prompt".
  it('SessionStart source=compact → ignored; other sources → WaitingForInput', () => {
    expect(hookStatus(evt({ hook_event_name: 'SessionStart', source: 'compact' }))).toBeNull()
    for (const source of ['startup', 'resume', 'clear', 'something-new']) {
      expect(hookStatus(evt({ hook_event_name: 'SessionStart', source }))).toEqual({
        kind: 'status',
        status: 'WaitingForInput'
      })
    }
  })

  // --- Stop: prose-question branch BOTH ways ---
  it('Stop with message ending in "?" → NeedsAttention', () => {
    expect(
      hookStatus(
        evt({ hook_event_name: 'Stop', last_assistant_message: 'Which option do you prefer?' })
      )
    ).toEqual({ kind: 'status', status: 'NeedsAttention' })
  })

  it('Stop without a question ends the turn as YourTurn (deterministic your-turn floor)', () => {
    expect(hookStatus({ session_id: 's1', hook_event_name: 'Stop' })).toEqual({
      kind: 'status',
      status: 'YourTurn'
    })
    expect(
      hookStatus({
        session_id: 's1',
        hook_event_name: 'Stop',
        last_assistant_message: 'Done. All tests pass.'
      })
    ).toEqual({ kind: 'status', status: 'YourTurn' })
  })

  it('Stop ending in a question still maps to NeedsAttention (urgency upgrade)', () => {
    expect(
      hookStatus({
        session_id: 's1',
        hook_event_name: 'Stop',
        last_assistant_message: 'Should I proceed?'
      })
    ).toEqual({ kind: 'status', status: 'NeedsAttention' })
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

  // --- a turn end with background work still running is Working (operator, 2026-09-29) ---
  // R5 made it a quiet your-turn, and looking at the session then demoted it to Idle while claude
  // still said "1 shell still running". Working is what the terminal shows; it never raises.
  it('Stop with a pending background task → Working (not YourTurn)', () => {
    expect(
      hookStatus(
        evt({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', status: 'running' }] })
      )
    ).toEqual({
      kind: 'status',
      status: 'Working'
    })
  })

  it('Stop with NO pending background task keeps the YourTurn floor', () => {
    expect(hookStatus(evt({ hook_event_name: 'Stop', background_tasks: [] }))).toEqual({
      kind: 'status',
      status: 'YourTurn'
    })
  })

  it('an omitted context behaves exactly like no pending background task', () => {
    expect(hookStatus(evt({ hook_event_name: 'Stop' }))).toEqual(
      hookStatus(evt({ hook_event_name: 'Stop', background_tasks: [] }))
    )
  })

  it('a QUESTION still wins over a pending background task — claude asked you something', () => {
    expect(
      hookStatus(
        evt({
          hook_event_name: 'Stop',
          last_assistant_message: 'Which option do you prefer?',
          background_tasks: [{ id: 'b1', status: 'running' }]
        })
      )
    ).toEqual({ kind: 'status', status: 'NeedsAttention' })
  })

  it('background_tasks does NOT change any non-Stop event', () => {
    const bg = [{ id: 'b1', status: 'running' }]
    expect(hookStatus(evt({ hook_event_name: 'SessionStart', background_tasks: bg }))).toEqual({
      kind: 'status',
      status: 'WaitingForInput'
    })
    expect(hookStatus(evt({ hook_event_name: 'SessionEnd', background_tasks: bg }))).toEqual({
      kind: 'removed'
    })
    expect(
      hookStatus(
        evt({
          hook_event_name: 'Notification',
          notification_type: 'permission_prompt',
          background_tasks: bg
        })
      )
    ).toEqual({ kind: 'status', status: 'NeedsPermission' })
  })
})
