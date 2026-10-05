// Hook-status feature — unit tests for the hookStatus event-OBJECT mapper.
//
// Runs under the `main-unit` Vitest project (node).
// Covers the full Phase-2 mapping table: the Notification permission_prompt vs
// idle_prompt split, the PreToolUse(AskUserQuestion) special-case, the Stop
// prose-question branch (both ways + absent message), SessionEnd → removed, and
// unknown events → null. [spec Tasks; spec I/O & Edge-Case Matrix; plan L1.3/L2.7]

import { describe, it, expect } from 'vitest'
import { clearedSessionStatus, hookStatus } from './hookStatus'
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
      fromTool: true,
      opensPrompt: true
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

  it('PostToolUse → Working, as a tool event that ends its call', () => {
    expect(hookStatus(evt({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }))).toEqual({
      kind: 'status',
      status: 'Working',
      fromTool: true,
      toolDone: true
    })
  })

  // ST-1: the call that opened a prompt is matched by its tool_use_id (and agent_id for a
  // subagent); its PostToolUse / PostToolUseFailure is what clears a prompt answered by click.
  it('tool events carry their tool_use_id and agent_id', () => {
    const call = { tool_name: 'Bash', tool_use_id: 'tu_1', agent_id: 'agent-x' }
    expect(hookStatus(evt({ hook_event_name: 'PreToolUse', ...call }))).toEqual({
      kind: 'status',
      status: 'Working',
      toolName: 'Bash',
      fromTool: true,
      toolUseId: 'tu_1',
      agentId: 'agent-x'
    })
    for (const name of ['PostToolUse', 'PostToolUseFailure']) {
      expect(hookStatus(evt({ hook_event_name: name, ...call }))).toEqual({
        kind: 'status',
        status: 'Working',
        fromTool: true,
        toolUseId: 'tu_1',
        agentId: 'agent-x',
        toolDone: true
      })
    }
  })

  // --- A prompt is NOT a tool event: it always moves the card ---
  it('UserPromptSubmit → Working', () => {
    expect(hookStatus(evt({ hook_event_name: 'UserPromptSubmit' }))).toEqual({
      kind: 'status',
      status: 'Working'
    })
  })

  // --- SessionStart never arrives (ST-7): claude refuses http hooks for it and for Setup ---
  it('SessionStart → null (claude 2.1.289 never delivers it to an http hook)', () => {
    expect(hookStatus(evt({ hook_event_name: 'SessionStart' }))).toBeNull()
    expect(hookStatus(evt({ hook_event_name: 'SessionStart', source: 'clear' }))).toBeNull()
  })

  // --- /clear: the old id's SessionEnd(reason "clear") is the one signal claude sends (ST-7) ---
  it('clearedSessionStatus: SessionEnd reason=clear → WaitingForInput (claude sits at an empty prompt)', () => {
    expect(clearedSessionStatus(evt({ hook_event_name: 'SessionEnd', reason: 'clear' }))).toEqual({
      kind: 'status',
      status: 'WaitingForInput'
    })
  })

  it('clearedSessionStatus: any other SessionEnd reason, or none → null (unprobed: keep the status)', () => {
    for (const reason of ['other', 'logout', 'prompt_input_exit', 'resume']) {
      expect(clearedSessionStatus(evt({ hook_event_name: 'SessionEnd', reason }))).toBeNull()
    }
    expect(clearedSessionStatus(evt({ hook_event_name: 'SessionEnd' }))).toBeNull()
  })

  it('clearedSessionStatus: reason=clear on a non-SessionEnd event → null', () => {
    expect(clearedSessionStatus(evt({ hook_event_name: 'Stop', reason: 'clear' }))).toBeNull()
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

  // --- ST-6: claude waits for input that is not a tool permission ---
  it.each(['worker_permission_prompt', 'agent_needs_input'])(
    'Notification(%s) → NeedsPermission (a dialog waits, like permission_prompt)',
    (type) => {
      expect(hookStatus(evt({ hook_event_name: 'Notification', notification_type: type }))).toEqual(
        { kind: 'status', status: 'NeedsPermission' }
      )
    }
  )

  it.each(['elicitation_dialog', 'elicitation_url_dialog'])(
    'Notification(%s) → NeedsAttention, never pulling a card out of a permission prompt',
    (type) => {
      expect(hookStatus(evt({ hook_event_name: 'Notification', notification_type: type }))).toEqual(
        { kind: 'status', status: 'NeedsAttention', fromTool: true }
      )
    }
  )

  it('Elicitation (an MCP server asks for input) → NeedsAttention', () => {
    expect(hookStatus(evt({ hook_event_name: 'Elicitation' }))).toEqual({
      kind: 'status',
      status: 'NeedsAttention',
      fromTool: true
    })
  })

  it('ElicitationResult (the operator answered the form) → Working', () => {
    expect(hookStatus(evt({ hook_event_name: 'ElicitationResult' }))).toEqual({
      kind: 'status',
      status: 'Working',
      fromTool: true
    })
  })

  // --- StopFailure: an API error ends the turn with NO Stop (ST-3) ---
  // Rate limit / overload / network / bad model: claude sends StopFailure and never Stop. The
  // turn is over and claude waits at the prompt, so it is the operator's turn.
  it('StopFailure (API error, no Stop follows) → YourTurn', () => {
    expect(
      hookStatus(
        evt({
          hook_event_name: 'StopFailure',
          error: 'model_not_found',
          last_assistant_message: 'Run /model to pick a different model.'
        })
      )
    ).toEqual({ kind: 'status', status: 'YourTurn' })
  })

  it('StopFailure stays YourTurn: its message is an error text, not a question from claude', () => {
    expect(
      hookStatus(
        evt({
          hook_event_name: 'StopFailure',
          last_assistant_message: 'Did you mean a different model?'
        })
      )
    ).toEqual({ kind: 'status', status: 'YourTurn' })
  })

  it('StopFailure stays YourTurn with background work running: the error still needs you', () => {
    expect(
      hookStatus(
        evt({ hook_event_name: 'StopFailure', background_tasks: [{ id: 'b1', status: 'running' }] })
      )
    ).toEqual({ kind: 'status', status: 'YourTurn' })
  })

  // --- PermissionRequest: the dialog opened, 6 s before Notification(permission_prompt) (ST-5) ---
  // Probe (claude 2.1.289): it fires only when a dialog shows — never for an auto-allowed tool —
  // in the same instant as the tool's PreToolUse. It is not a tool event: it must be able to put
  // the card INTO NeedsPermission, and it names the tool the prompt is for (R14).
  it('PermissionRequest (a permission dialog opened) → NeedsPermission, naming the tool', () => {
    expect(hookStatus(evt({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }))).toEqual({
      kind: 'status',
      status: 'NeedsPermission',
      toolName: 'Bash',
      opensPrompt: true
    })
    expect(hookStatus(evt({ hook_event_name: 'PermissionRequest' }))).toEqual({
      kind: 'status',
      status: 'NeedsPermission',
      opensPrompt: true
    })
    // A subagent's dialog names its agent, so it links to that agent's own PreToolUse (ST-1).
    expect(
      hookStatus(evt({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', agent_id: 'a1' }))
    ).toEqual({
      kind: 'status',
      status: 'NeedsPermission',
      toolName: 'Bash',
      agentId: 'a1',
      opensPrompt: true
    })
  })

  it('PermissionRequest for AskUserQuestion → ignored (its PreToolUse already said needs-you)', () => {
    // The question's own PreToolUse sets NeedsAttention in the same instant, so there is no gap
    // to close. NeedsPermission here would only let a click answer leave it stuck (ST-1).
    expect(
      hookStatus(evt({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' }))
    ).toBeNull()
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
    expect(hookStatus(evt({ hook_event_name: 'UserPromptSubmit', background_tasks: bg }))).toEqual({
      kind: 'status',
      status: 'Working'
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

  // --- PreCompact / PostCompact: a manual /compact is claude working (ST-8) ---
  // Probe S11 (claude 2.1.289): /compact sends only these two, ~13 s apart. `trigger` is
  // "manual" for /compact and "auto" when the context fills up mid-turn.
  it('PreCompact(manual) → Working: claude is summarizing the conversation', () => {
    expect(hookStatus(evt({ hook_event_name: 'PreCompact', trigger: 'manual' }))).toEqual({
      kind: 'status',
      status: 'Working'
    })
  })

  it('PostCompact(manual) → YourTurn: the compaction is over and claude waits at the prompt', () => {
    expect(
      hookStatus(evt({ hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: 's' }))
    ).toEqual({ kind: 'status', status: 'YourTurn' })
  })

  it.each(['PreCompact', 'PostCompact'])(
    '%s with trigger auto, absent or unknown → null (an auto compact runs inside a turn)',
    (name) => {
      expect(hookStatus(evt({ hook_event_name: name, trigger: 'auto' }))).toBeNull()
      expect(hookStatus(evt({ hook_event_name: name }))).toBeNull()
      expect(hookStatus(evt({ hook_event_name: name, trigger: 'something_new' }))).toBeNull()
    }
  )
})
