// Phase 2 END-TO-END (main-unit) — the one test that proves the WHOLE POINT:
// a Claude Code hook event flips the board to the `needs-you` column, instantly and
// by construction, with NO reducer/columns.ts change.
//
// The full chain under test (the real production wiring, mirrored from
// src/main/index.ts's hook chokepoint + handleDelta ordering):
//
//   Notification(permission_prompt)            (the inbound, schema-validated hook event)
//     ─hookStatus(evt)─▶ { kind:'status', status:'NeedsPermission' }
//     ─reducer.applyHookStatus─▶ SessionDelta (session.updated carrying NeedsPermission)
//     ─tracker.onDelta─▶ (computes the column from the delta's status)
//     ─enrichDelta─▶ enriched payload whose event.column === 'needs-you'
//
// We use the REAL tracker + REAL enrichDelta (not stubs) so the test fails if the
// status→column classifier, the tracker's column bookkeeping, or the enrich seam ever
// drift. The reducer's status is a FREE string and columnForStatus already maps
// NeedsPermission/NeedsAttention → needs-you, so emitting those statuses from a hook
// reaches the right column with no reducer/columns edit. [plan-hook-phase2; columns.ts:63]
import { describe, it, expect } from 'vitest'
import { createReducer } from '../c9watch/reducer'
import { createAttentionTracker } from '../c9watch/attention'
import { enrichDelta } from '../c9watch/enrichDelta'
import { hookStatus } from './hookStatus'
import { createOrphanRegistry, keepCardOnLiveSessionEnd } from './sessionRebind'
import { applyApprovalKey } from '../pty/approvalKey'
import { HookEventSchema } from '../../shared/schemas/hookEvent'
import { launchedSession } from '../../__fixtures__/fakeSessions'

const FIXED_NOW = 1_750_000_000_000

/**
 * Run the production chain for ONE hook event and return the enriched delta the
 * renderer would receive. Mirrors index.ts: tracker.onDelta FIRST (populates the
 * tracker's column map for this id), THEN enrichDelta reads the now-current tracker.
 */
function runHookToColumn(id: string, rawHookBody: unknown): ReturnType<typeof enrichDelta> {
  const reducer = createReducer({ now: () => FIXED_NOW })
  const tracker = createAttentionTracker({ now: () => FIXED_NOW })

  // The session must be KNOWN before a hook can change its status (applyHookStatus does
  // NOT upsert an unknown id — external sessions stay off the board). In the native
  // engine a session becomes known at SPAWN via upsertLaunched (Story 6.2).
  for (const delta of reducer.upsertLaunched(launchedSession(id, { status: 'Working' }))) {
    tracker.onDelta(delta, reducer.snapshotMap())
  }

  // The hook body crosses the SAME fail-closed Zod boundary it would over HTTP.
  const evt = HookEventSchema.parse(rawHookBody)

  const change = hookStatus(evt)
  expect(change).not.toBeNull()
  if (change === null) throw new Error('unreachable: change asserted non-null')

  const deltas = reducer.applyHookStatus(id, change)
  expect(deltas).toHaveLength(1)
  const delta = deltas[0]
  if (delta === undefined) throw new Error('unreachable: delta asserted present')

  // Production ordering (index.ts handleDelta): tracker FIRST, then enrich.
  tracker.onDelta(delta, reducer.snapshotMap())
  return enrichDelta(delta, tracker, reducer.snapshotMap())
}

describe('Phase 2 end-to-end — hook event → board column (the whole point)', () => {
  it('Notification(permission_prompt) for a KNOWN id enriches to column "needs-you"', () => {
    const id = 'e2e0perm-0000-4000-8000-000000000001'
    const enriched = runHookToColumn(id, {
      session_id: id,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt'
    })

    expect(enriched).not.toBeNull()
    expect(enriched?.event.type).toBe('session.updated')
    if (enriched?.event.type === 'session.updated') {
      expect(enriched.event.status).toBe('NeedsPermission') // status carried verbatim
      expect(enriched.event.column).toBe('needs-you') // mapped by construction
      expect(enriched.event.id).toBe(id)
    }
  })

  it('PreToolUse(AskUserQuestion) for a KNOWN id enriches to column "needs-you"', () => {
    // The other needs-you driver — proves both NeedsAttention and NeedsPermission reach
    // the same column with no reducer/columns change.
    const id = 'e2e0attn-0000-4000-8000-000000000001'
    const enriched = runHookToColumn(id, {
      session_id: id,
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion'
    })

    expect(enriched).not.toBeNull()
    expect(enriched?.event.type).toBe('session.updated')
    if (enriched?.event.type === 'session.updated') {
      expect(enriched.event.status).toBe('NeedsAttention')
      expect(enriched.event.column).toBe('needs-you')
      expect(enriched.event.id).toBe(id)
    }
  })

  it('StopFailure (API error) moves a Working card to "needs-you" (ST-3)', () => {
    // Probe-shaped body (claude 2.1.289, `model_not_found`): no Stop follows it.
    const id = 'e2e0fail-0000-4000-8000-000000000001'
    const enriched = runHookToColumn(id, {
      session_id: id,
      hook_event_name: 'StopFailure',
      error: 'model_not_found',
      last_assistant_message: 'Run /model to pick a different model.'
    })

    expect(enriched?.event.type).toBe('session.updated')
    if (enriched?.event.type === 'session.updated') {
      expect(enriched.event.status).toBe('YourTurn')
      expect(enriched.event.column).toBe('needs-you')
    }
  })

  it('/clear on a live pty: the kept card leaves its old status for idle (ST-7)', () => {
    // Probe (claude 2.1.289): /clear sends `SessionEnd reason:"clear"` for the OLD id and no
    // SessionStart (claude refuses http hooks for it). The pty lives on, so watchFeed keeps the
    // card and applies clearedSessionStatus — claude sits at an empty prompt.
    const id = 'e2e0clr0-0000-4000-8000-000000000001'
    const reducer = createReducer({ now: () => FIXED_NOW })
    const tracker = createAttentionTracker({ now: () => FIXED_NOW })
    let raises = 0
    const ship = (deltas: ReturnType<typeof reducer.applyHookStatus>): void => {
      for (const delta of deltas) raises += tracker.onDelta(delta, reducer.snapshotMap()).length
    }
    ship(reducer.upsertLaunched(launchedSession(id, { status: 'Working' })))
    ship(reducer.applyHookStatus(id, { kind: 'status', status: 'YourTurn' }))
    expect(tracker.columnOf(id)).toBe('needs-you')
    raises = 0

    const evt = HookEventSchema.parse({
      session_id: id,
      hook_event_name: 'SessionEnd',
      reason: 'clear'
    })
    expect(hookStatus(evt)).toEqual({ kind: 'removed' })
    // watchFeed's SessionEnd step, with the real reducer behind it.
    const kept = keepCardOnLiveSessionEnd(evt, {
      launch: { terminalIdFor: (s) => (s === id ? 'term-1' : null) },
      live: { has: (t) => t === 'term-1' },
      orphans: createOrphanRegistry(),
      parked: () => false,
      now: FIXED_NOW,
      applyStatus: (sessionId, change) => ship(reducer.applyHookStatus(sessionId, change)),
      log: () => undefined
    })
    expect(kept).toBe(true)

    expect(reducer.snapshotMap().get(id)?.status).toBe('WaitingForInput')
    expect(tracker.columnOf(id)).toBe('idle')
    expect(raises).toBe(0) // idle is the calm column: no alert
  })

  it('a permission dialog says needs-you the instant it opens, and its late Notification raises nothing new (ST-5)', () => {
    // Probe S7 (claude 2.1.289): PreToolUse(Bash) and PermissionRequest(Bash) in the same
    // instant, Notification(permission_prompt) 6 s later. The card must be needs-you from the
    // PermissionRequest on, and the late Notification must not alert a second time.
    const id = 'e2e0preq-0000-4000-8000-000000000001'
    const reducer = createReducer({ now: () => FIXED_NOW })
    const tracker = createAttentionTracker({ now: () => FIXED_NOW })
    for (const delta of reducer.upsertLaunched(launchedSession(id, { status: 'Working' }))) {
      tracker.onDelta(delta, reducer.snapshotMap())
    }
    let raises = 0
    const post = (body: Record<string, unknown>): void => {
      const change = hookStatus(HookEventSchema.parse({ session_id: id, ...body }))
      if (change === null) return
      for (const delta of reducer.applyHookStatus(id, change)) {
        raises += tracker.onDelta(delta, reducer.snapshotMap()).length
      }
    }

    post({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })
    post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })

    expect(reducer.snapshotMap().get(id)?.status).toBe('NeedsPermission')
    expect(reducer.snapshotMap().get(id)?.pendingToolName).toBe('Bash')
    expect(tracker.columnOf(id)).toBe('needs-you')
    expect(raises).toBe(1)

    post({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })

    expect(reducer.snapshotMap().get(id)?.status).toBe('NeedsPermission')
    expect(reducer.snapshotMap().get(id)?.pendingToolName).toBe('Bash')
    expect(raises).toBe(1)
  })

  // ST-1 (probe claude 2.1.289): a prompt answered by a mouse click or shift+tab sends no key the
  // app can read; the ONLY event after it is the answered tool's own PostToolUse (or
  // PostToolUseFailure), carrying the same tool_use_id as the PreToolUse that opened the prompt.
  // That event must clear needs-you; every other tool event keeps R20 (a parallel subagent).
  describe('a prompt is cleared by its own tool finishing (ST-1)', () => {
    function replay(): {
      post: (body: Record<string, unknown>) => void
      status: () => string | undefined
    } {
      const id = 'e2e0st01-0000-4000-8000-000000000001'
      const reducer = createReducer({ now: () => FIXED_NOW })
      reducer.upsertLaunched(launchedSession(id, { status: 'Working' }))
      return {
        post: (body) => {
          const change = hookStatus(HookEventSchema.parse({ session_id: id, ...body }))
          if (change !== null) reducer.applyHookStatus(id, change)
        },
        status: () => reducer.snapshotMap().get(id)?.status
      }
    }
    const notify = { hook_event_name: 'Notification', notification_type: 'permission_prompt' }

    it('AskUserQuestion answered by click: its PostToolUse moves the card to Working (S2)', () => {
      const { post, status } = replay()
      post({ hook_event_name: 'UserPromptSubmit' })
      post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu_A' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' })
      post(notify)
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu_A' })
      expect(status()).toBe('Working')
    })

    it.each(['Bash', 'ExitPlanMode'])(
      '%s prompt approved by click / shift+tab: its PostToolUse moves the card to Working (S5, S6)',
      (tool) => {
        const { post, status } = replay()
        post({ hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: 'tu_B' })
        post({ hook_event_name: 'PermissionRequest', tool_name: tool })
        post(notify)
        expect(status()).toBe('NeedsPermission')
        post({ hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: 'tu_B' })
        expect(status()).toBe('Working')
      }
    )

    it('approved within the first 6 s (no Notification yet): its PostToolUse moves the card to Working', () => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      expect(status()).toBe('Working')
    })

    it('an approved tool that then fails ends with PostToolUseFailure, which clears it too', () => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      post(notify)
      post({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'tu_B' })
      expect(status()).toBe('Working')
    })

    it("a parallel subagent's tool events never clear the main agent's prompt (R20)", () => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      // A subagent tool lands between the PreToolUse and its PermissionRequest.
      const sub = { agent_id: 'agent-x', tool_name: 'Bash', tool_use_id: 'tu_C' }
      post({ hook_event_name: 'PreToolUse', ...sub })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      post({ hook_event_name: 'PostToolUse', ...sub })
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      expect(status()).toBe('Working')
    })

    it("a subagent's own prompt is cleared by that subagent's tool finishing (probe K-sub)", () => {
      const { post, status } = replay()
      const sub = { agent_id: 'agent-x', tool_name: 'Bash', tool_use_id: 'tu_D' }
      post({ hook_event_name: 'PreToolUse', ...sub })
      post({ hook_event_name: 'PermissionRequest', agent_id: 'agent-x', tool_name: 'Bash' })
      post(notify)
      post({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'tu_E' })
      post({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'tu_E' })
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', ...sub })
      expect(status()).toBe('Working')
    })

    it('two prompts open: answering the first keeps needs-you until the second is answered', () => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      const sub = { agent_id: 'agent-x', tool_name: 'Write', tool_use_id: 'tu_D' }
      post({ hook_event_name: 'PreToolUse', ...sub })
      post({ hook_event_name: 'PermissionRequest', agent_id: 'agent-x', tool_name: 'Write' })
      post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', ...sub })
      expect(status()).toBe('Working')
    })

    it('a prompt for a different tool than the last PreToolUse links nothing (never a wrong clear)', () => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'tu_C' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      post({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'tu_C' })
      expect(status()).toBe('NeedsPermission')
    })

    it('a denied prompt (no tool event follows) does not keep a later answered prompt stuck', () => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      // Denied: claude sends no tool event; the interrupt / next prompt moves the card.
      post({ hook_event_name: 'Stop' })
      post({ hook_event_name: 'UserPromptSubmit' })
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_F' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu_F' })
      expect(status()).toBe('Working')
    })
  })

  // ST-2 (probe S4, claude 2.1.289): Enter on question 1 of a multi-question AskUserQuestion
  // answers only that question; question 2 and a "Submit answers" screen follow with no hook
  // until the tool's own PostToolUse. The approval key (R4) must not read that Enter as the
  // answer, in either phase: NeedsAttention (first 6 s) or NeedsPermission (after the
  // Notification). The question's PostToolUse is its way out (ST-1).
  describe('an open AskUserQuestion is not answered by a key (ST-2)', () => {
    function replay(): {
      post: (body: Record<string, unknown>) => void
      key: (data: string) => void
      interrupt: () => void
      status: () => string | undefined
    } {
      const id = 'e2e0st02-0000-4000-8000-000000000001'
      const reducer = createReducer({ now: () => FIXED_NOW })
      reducer.upsertLaunched(launchedSession(id, { status: 'Working' }))
      const status = (): string | undefined => reducer.snapshotMap().get(id)?.status
      return {
        post: (body) => {
          const change = hookStatus(HookEventSchema.parse({ session_id: id, ...body }))
          if (change !== null) reducer.applyHookStatus(id, change)
        },
        // watchFeed's keyLaunched seam.
        key: (data) => {
          applyApprovalKey(
            status(),
            data,
            (c) => reducer.applyHookStatus(id, c),
            () => undefined
          )
        },
        // watchFeed's demoteOnInterrupt sends exactly this change.
        interrupt: () => {
          reducer.applyHookStatus(id, { kind: 'status', status: 'WaitingForInput' })
        },
        status
      }
    }
    const notify = { hook_event_name: 'Notification', notification_type: 'permission_prompt' }
    const ask = { tool_name: 'AskUserQuestion', tool_use_id: 'tu_Q' }

    it('two questions after the Notification: Enter, Enter, Submit keep needs-you; its PostToolUse ends it (S4)', () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...ask })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' })
      post(notify)
      expect(status()).toBe('NeedsPermission')
      for (const data of ['\r', '2', '\r', '1']) {
        key(data)
        expect(status()).toBe('NeedsPermission')
      }
      post({ hook_event_name: 'PostToolUse', ...ask })
      expect(status()).toBe('Working')
    })

    it('two questions in the first 6 s: Enter keeps NeedsAttention, the Notification still lands', () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...ask })
      key('\r')
      expect(status()).toBe('NeedsAttention')
      post(notify)
      key('\r')
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', ...ask })
      expect(status()).toBe('Working')
    })

    it('one question answered by Enter leaves needs-you through its own PostToolUse (S1)', () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...ask })
      post(notify)
      key('\r')
      post({ hook_event_name: 'PostToolUse', ...ask })
      expect(status()).toBe('Working')
    })

    it('Esc on an open question still interrupts to idle', () => {
      const { post, interrupt, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...ask })
      post(notify)
      interrupt()
      expect(status()).toBe('WaitingForInput')
    })

    it('a Bash permission prompt is still answered by Enter (R4 kept)', () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      post(notify)
      key('\r')
      expect(status()).toBe('Working')
    })

    it('after the question closes, a later Bash prompt is answered by Enter again', () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...ask })
      post(notify)
      post({ hook_event_name: 'PostToolUse', ...ask })
      post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
      post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
      key('1')
      expect(status()).toBe('Working')
    })

    it('a question with no tool_use_id (no hook way out) keeps the old key path, never stuck', () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })
      post(notify)
      key('\r')
      expect(status()).toBe('Working')
    })

    it("a subagent's Bash prompt and the main question both open: Enter keeps needs-you", () => {
      const { post, key, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...ask })
      const sub = { agent_id: 'agent-x', tool_name: 'Bash', tool_use_id: 'tu_D' }
      post({ hook_event_name: 'PreToolUse', ...sub })
      post({ hook_event_name: 'PermissionRequest', agent_id: 'agent-x', tool_name: 'Bash' })
      key('\r')
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', ...ask })
      expect(status()).toBe('NeedsPermission')
      post({ hook_event_name: 'PostToolUse', ...sub })
      expect(status()).toBe('Working')
    })
  })
})

// ST-6 (claude 2.1.289 trace, docs/reports/2026-10-05-status-hunt S10): claude also waits on the
// operator for an MCP server's input form (`Elicitation` hook the instant it asks,
// `Notification(elicitation_dialog | elicitation_url_dialog)` 6 s later, `ElicitationResult` once
// answered), on a teammate's permission (`worker_permission_prompt`) and on a blocked agent
// (`agent_needs_input`). The app mapped only `permission_prompt`, so the card stayed Working.
describe('claude waits for input that is not a tool permission (ST-6)', () => {
  function replay(): {
    post: (body: Record<string, unknown>) => void
    key: (data: string) => void
    status: () => string | undefined
    pendingToolName: () => string | undefined
    raises: () => number
  } {
    const id = 'e2e0st06-0000-4000-8000-000000000001'
    const reducer = createReducer({ now: () => FIXED_NOW })
    const tracker = createAttentionTracker({ now: () => FIXED_NOW })
    for (const delta of reducer.upsertLaunched(launchedSession(id, { status: 'Working' }))) {
      tracker.onDelta(delta, reducer.snapshotMap())
    }
    let raises = 0
    const ship = (deltas: ReturnType<typeof reducer.applyHookStatus>): void => {
      for (const delta of deltas) raises += tracker.onDelta(delta, reducer.snapshotMap()).length
    }
    const status = (): string | undefined => reducer.snapshotMap().get(id)?.status
    return {
      post: (body) => {
        const change = hookStatus(HookEventSchema.parse({ session_id: id, ...body }))
        if (change !== null) ship(reducer.applyHookStatus(id, change))
      },
      key: (data) => {
        ship(
          applyApprovalKey(
            status(),
            data,
            (c) => reducer.applyHookStatus(id, c),
            () => undefined
          )
        )
      },
      status,
      pendingToolName: () => reducer.snapshotMap().get(id)?.pendingToolName,
      raises: () => raises
    }
  }
  const mcpCall = { tool_name: 'mcp__deploy__release', tool_use_id: 'tu_M' }
  const elicit = {
    hook_event_name: 'Elicitation',
    mcp_server_name: 'deploy',
    message: 'Which environment?',
    mode: 'form'
  }
  const answered = {
    hook_event_name: 'ElicitationResult',
    mcp_server_name: 'deploy',
    mode: 'form',
    action: 'accept'
  }

  it('an MCP form says needs-you the instant it asks, naming no tool; its late Notification raises nothing new', () => {
    const { post, status, pendingToolName, raises } = replay()
    post({ hook_event_name: 'UserPromptSubmit' })
    post({ hook_event_name: 'PreToolUse', ...mcpCall })
    post(elicit)
    expect(status()).toBe('NeedsAttention')
    expect(pendingToolName()).toBeUndefined()
    expect(raises()).toBe(1)

    post({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' })
    expect(status()).toBe('NeedsAttention')
    expect(raises()).toBe(1)
  })

  it.each(['accept', 'decline', 'cancel'])(
    'the answered form (%s) moves the card back to Working',
    (action) => {
      const { post, status } = replay()
      post({ hook_event_name: 'PreToolUse', ...mcpCall })
      post(elicit)
      post({ ...answered, action })
      expect(status()).toBe('Working')
    }
  )

  it('Enter in the form is not read as an answer: the card stays needs-you until ElicitationResult', () => {
    const { post, key, status } = replay()
    post({ hook_event_name: 'PreToolUse', ...mcpCall })
    post(elicit)
    post({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' })
    key('\r')
    expect(status()).toBe('NeedsAttention')
    post(answered)
    expect(status()).toBe('Working')
  })

  it('a URL elicitation notification alone also says needs-you', () => {
    const { post, status } = replay()
    post({ hook_event_name: 'Notification', notification_type: 'elicitation_url_dialog' })
    expect(status()).toBe('NeedsAttention')
  })

  it('the MCP tool finishing also ends the wait (no stuck card)', () => {
    const { post, status } = replay()
    post({ hook_event_name: 'PreToolUse', ...mcpCall })
    post({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' })
    post({ hook_event_name: 'PostToolUse', ...mcpCall })
    expect(status()).toBe('Working')
  })

  it("an elicitation never pulls a card out of an open permission prompt, and its answer doesn't either", () => {
    // A subagent's Bash prompt is open while the main agent's MCP tool asks for input.
    const { post, status, pendingToolName } = replay()
    post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B', agent_id: 'a1' })
    post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', agent_id: 'a1' })
    post(elicit)
    post({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' })
    expect(status()).toBe('NeedsPermission')
    expect(pendingToolName()).toBe('Bash')
    post(answered)
    expect(status()).toBe('NeedsPermission')
    // The Bash prompt's own tool finishing still clears it (ST-1 bookkeeping kept).
    post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu_B', agent_id: 'a1' })
    expect(status()).toBe('Working')
  })

  it.each(['worker_permission_prompt', 'agent_needs_input'])(
    'Notification(%s) is a dialog waiting like a permission prompt: needs-you, answered by Enter',
    (type) => {
      const { post, key, status, raises } = replay()
      post({ hook_event_name: 'UserPromptSubmit' })
      post({ hook_event_name: 'Notification', notification_type: type })
      expect(status()).toBe('NeedsPermission')
      expect(raises()).toBe(1)
      key('\r')
      expect(status()).toBe('Working')
    }
  )
})

// ST-8 (probe S11, claude 2.1.289): a manual /compact sends only PreCompact and PostCompact
// (`trigger: "manual"`), ~13 s apart. The card kept its old status while claude compacted.
describe('a manual /compact shows as work (ST-8)', () => {
  function replay(from: string): {
    post: (body: Record<string, unknown>) => void
    status: () => string | undefined
    column: () => string | undefined
  } {
    const id = 'e2e0st08-0000-4000-8000-000000000001'
    const reducer = createReducer({ now: () => FIXED_NOW })
    const tracker = createAttentionTracker({ now: () => FIXED_NOW })
    const ship = (deltas: ReturnType<typeof reducer.applyHookStatus>): void => {
      for (const delta of deltas) tracker.onDelta(delta, reducer.snapshotMap())
    }
    ship(reducer.upsertLaunched(launchedSession(id, { status: from })))
    return {
      post: (body) => {
        const change = hookStatus(HookEventSchema.parse({ session_id: id, ...body }))
        if (change !== null) ship(reducer.applyHookStatus(id, change))
      },
      status: () => reducer.snapshotMap().get(id)?.status,
      column: () => tracker.columnOf(id)
    }
  }

  it.each(['YourTurn', 'WaitingForInput'])(
    '%s → Working while /compact runs → your turn when it is done',
    (from) => {
      const { post, status, column } = replay(from)
      post({ hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: null })
      expect(status()).toBe('Working')
      expect(column()).toBe('working')
      post({ hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: 'summary' })
      expect(status()).toBe('YourTurn')
      expect(column()).toBe('needs-you')
    }
  )

  it('an auto compact mid-turn leaves the turn alone, open prompt included', () => {
    const { post, status } = replay('Working')
    post({ hook_event_name: 'UserPromptSubmit' })
    post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
    post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
    expect(status()).toBe('NeedsPermission')
    post({ hook_event_name: 'PreCompact', trigger: 'auto' })
    post({ hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: 'summary' })
    expect(status()).toBe('NeedsPermission')
    // The prompt bookkeeping survived: its own tool finishing still clears it (ST-1).
    post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu_B' })
    expect(status()).toBe('Working')
  })
})
