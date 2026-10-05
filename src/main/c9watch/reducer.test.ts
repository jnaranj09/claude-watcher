// The session reducer tests (main-unit / node project) — native engine (Story 6.4).
//
// The c9watch line/snapshot boundary tests died with the CLI (applyLine /
// seedFromSnapshot are gone — the external fail-closed boundary is now the hook POST,
// covered in src/__fixtures__/fakeHookFeed.test.ts + hookServer.test.ts). What remains
// under test here is the reducer's surviving surface:
//   - upsertLaunched (Story 6.2 spawn-time synthesis; upsert semantics, delta shape),
//   - applyHookStatus (status transitions + removal; unknown-id no-op + value-free log;
//     Story 6.3 idempotent removal),
//   - the injected-now() determinism stamp and the defensive snapshotMap copy.
// All deterministic: injected `now()`, no live claude, no wall clock.
import { describe, it, expect, vi } from 'vitest'
import { createReducer, type SessionDelta } from './reducer'
import { launchedSession } from '../../__fixtures__/fakeSessions'
import { createAttentionTracker } from './attention'
import type { Session } from '../../shared/schemas/session'

const FIXED_NOW = 1_750_000_000_000

describe('reducer — upsertLaunched (Story 6.2: spawn-time launch synthesis)', () => {
  it('emits ONE epoch-framed session.updated carrying the synthesized fields + enters the map', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch01-0000-4000-8000-000000000001'

    const deltas = r.upsertLaunched(
      launchedSession(id, { projectPath: '/home/op/proj', sessionName: 'proj', pid: 4242 })
    )

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event).toEqual({
      type: 'session.updated',
      id,
      sessionName: 'proj',
      projectPath: '/home/op/proj',
      status: 'Connecting'
    })
    // The delta is epoch-framed (the renderer's stale-discard contract).
    expect(deltas[0]?.epoch).toBe(r.epoch())
    // Session truth: the full synthesized session (incl. pid) is in the authoritative map.
    const stored = r.snapshotMap().get(id)
    expect(stored?.pid).toBe(4242)
    expect(stored?.status).toBe('Connecting')
    expect(r.lastAppliedAt()).toBe(FIXED_NOW) // injected clock, not the wall clock
  })

  it('a SECOND upsertLaunched for the SAME id is a NORMAL update — never a throw', () => {
    // DOCUMENTED DECISION (Story 6.2): a same-id re-upsert (a Reopen re-spawn under the
    // same frame) refreshes the stored session and emits ONE updated delta — no duplicate
    // card, no crash.
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch03-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    let deltas: SessionDelta[] = []
    expect(() => {
      deltas = r.upsertLaunched(launchedSession(id, { pid: 5151 }))
    }).not.toThrow()

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(r.size()).toBe(1) // updated, not duplicated
    expect(r.snapshotMap().get(id)?.pid).toBe(5151) // the refresh landed
  })

  it('the upsert REPLACES wholesale — a fresh spawn is the new truth (Connecting again)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch04-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))
    // A hook transitions the session…
    r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(r.snapshotMap().get(id)?.status).toBe('Working')
    // …then the frame re-spawns under the same id: the fresh upsert is the new truth.
    r.upsertLaunched(launchedSession(id))
    expect(r.snapshotMap().get(id)?.status).toBe('Connecting')
  })

  it('a re-upsert under a new id keeps the workspaceId (the /clear rebind)', () => {
    const reducer = createReducer({ now: () => 1 })
    const stored = {
      id: 'old',
      status: 'Working',
      projectPath: '/p',
      pid: 3,
      sessionName: 'n',
      workspaceId: 'w5',
      tagIds: [],
      templateId: null
    }
    reducer.upsertLaunched(stored)
    reducer.upsertLaunched({ ...stored, id: 'new' })
    expect(reducer.snapshotMap().get('new')?.workspaceId).toBe('w5')
  })

  it('a re-upsert under a new id keeps the tags and the template (the /clear rebind, spec §5)', () => {
    const reducer = createReducer({ now: () => 1 })
    const stored = launchedSession('old', { tagIds: ['t1'], templateId: 'tpl-1' })
    reducer.upsertLaunched(stored)
    reducer.upsertLaunched({ ...stored, id: 'new' })
    expect(reducer.snapshotMap().get('new')).toMatchObject({ tagIds: ['t1'], templateId: 'tpl-1' })
  })
})

describe('reducer — applyHookStatus (hooks own every status transition)', () => {
  it.each([
    ['Working'], // UserPromptSubmit / PreToolUse / PostToolUse
    ['WaitingForInput'], // Stop (plain prose)
    ['NeedsPermission'], // Notification(permission_prompt)
    ['NeedsAttention'] // PreToolUse(AskUserQuestion) / Stop ending in '?'
  ])('hook %s ships a session.updated CARRYING that status verbatim', (status) => {
    // The reducer's only job is to carry the FREE status string faithfully — the
    // status is NOT enum-locked and columnForStatus classifies it downstream.
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0001-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    const deltas = r.applyHookStatus(id, { kind: 'status', status })
    expect(deltas).toHaveLength(1)
    const evt = deltas[0]?.event
    expect(evt?.type).toBe('session.updated')
    if (evt?.type === 'session.updated') expect(evt.status).toBe(status)
    expect(r.snapshotMap().get(id)?.status).toBe(status)
  })

  it('a status transition keeps the other synthesized fields (merge, not replace)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0002-0000-4000-8000-000000000001'
    r.upsertLaunched(
      launchedSession(id, {
        projectPath: '/home/op/keepme',
        sessionName: 'keepme',
        pid: 7777
      })
    )

    r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    const stored = r.snapshotMap().get(id)
    expect(stored?.projectPath).toBe('/home/op/keepme')
    expect(stored?.sessionName).toBe('keepme')
    expect(stored?.pid).toBe(7777)
  })

  // R14: a permission prompt names the tool of the LAST PreToolUse (the Notification itself does
  // not carry one), and the name lives only while the card waits.
  it('NeedsPermission takes the last PreToolUse tool name; leaving it clears the name', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook00a1-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))
    r.applyHookStatus(id, { kind: 'status', status: 'Working', toolName: 'Read', fromTool: true })
    r.applyHookStatus(id, { kind: 'status', status: 'Working', toolName: 'Bash', fromTool: true })
    expect(r.snapshotMap().get(id)?.pendingToolName).toBeUndefined()
    r.applyHookStatus(id, { kind: 'status', status: 'NeedsPermission' })
    expect(r.snapshotMap().get(id)?.pendingToolName).toBe('Bash')
    r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(r.snapshotMap().get(id)?.pendingToolName).toBeUndefined()
  })

  it('AskUserQuestion names itself; a Stop question names no tool', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook00a2-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))
    const ask = { kind: 'status', status: 'NeedsAttention', fromTool: true } as const
    r.applyHookStatus(id, { ...ask, toolName: 'AskUserQuestion' })
    expect(r.snapshotMap().get(id)?.pendingToolName).toBe('AskUserQuestion')
    r.applyHookStatus(id, { kind: 'status', status: 'Working', toolName: 'Bash', fromTool: true })
    r.applyHookStatus(id, { kind: 'status', status: 'NeedsAttention' })
    expect(r.snapshotMap().get(id)?.pendingToolName).toBeUndefined()
  })

  // R20: a parallel subagent keeps firing tool events while the prompt is open; they must not
  // move the card out of needs-you. A non-tool status (a prompt, a Stop) still does.
  it('a tool event never pulls a card out of NeedsPermission; a non-tool status does', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook00a3-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))
    r.applyHookStatus(id, { kind: 'status', status: 'Working', toolName: 'Bash', fromTool: true })
    r.applyHookStatus(id, { kind: 'status', status: 'NeedsPermission' })
    const pre = { kind: 'status', status: 'Working', toolName: 'Grep', fromTool: true } as const
    expect(r.applyHookStatus(id, pre)).toEqual([])
    expect(r.applyHookStatus(id, { kind: 'status', status: 'Working', fromTool: true })).toEqual([])
    expect(r.snapshotMap().get(id)?.status).toBe('NeedsPermission')
    expect(r.snapshotMap().get(id)?.pendingToolName).toBe('Bash')
    expect(r.applyHookStatus(id, { kind: 'status', status: 'YourTurn' })).toHaveLength(1)
    expect(r.snapshotMap().get(id)?.status).toBe('YourTurn')
  })

  // ST-1: only the finished call that opened the prompt may clear it. A done event with no id
  // cannot be matched, so it keeps R20.
  it('a finished tool call without a tool_use_id never clears an open prompt', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook00a4-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))
    const pre = { kind: 'status', status: 'Working', toolName: 'Bash', fromTool: true } as const
    r.applyHookStatus(id, { ...pre, toolUseId: 'tu_B' })
    r.applyHookStatus(id, {
      kind: 'status',
      status: 'NeedsPermission',
      toolName: 'Bash',
      opensPrompt: true
    })
    const done = { kind: 'status', status: 'Working', fromTool: true, toolDone: true } as const
    expect(r.applyHookStatus(id, done)).toEqual([])
    expect(r.snapshotMap().get(id)?.status).toBe('NeedsPermission')
  })

  // ST-1: a removed session's open prompts go with it; a same-id relaunch starts clean.
  it('removing a session mid-prompt forgets its open prompts', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook00a5-0000-4000-8000-000000000001'
    const pre = { kind: 'status', status: 'Working', toolName: 'Bash', fromTool: true } as const
    const ask = {
      kind: 'status',
      status: 'NeedsPermission',
      toolName: 'Bash',
      opensPrompt: true
    } as const
    r.upsertLaunched(launchedSession(id))
    r.applyHookStatus(id, { ...pre, toolUseId: 'tu_old' })
    r.applyHookStatus(id, ask)
    r.applyHookStatus(id, { kind: 'removed' })
    r.upsertLaunched(launchedSession(id))
    r.applyHookStatus(id, { ...pre, toolUseId: 'tu_new' })
    r.applyHookStatus(id, ask)
    r.applyHookStatus(id, {
      kind: 'status',
      status: 'Working',
      fromTool: true,
      toolUseId: 'tu_new',
      toolDone: true
    })
    expect(r.snapshotMap().get(id)?.status).toBe('Working')
  })

  it('hook removed emits session.removed and deletes from the map', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0003-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    const deltas = r.applyHookStatus(id, { kind: 'removed' })
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.removed')
    expect(r.snapshotMap().has(id)).toBe(false)
  })

  it('unknown session_id → [] + log { path: "(hook)", code: "hook_unknown_id" } (no upsert)', () => {
    // Hooks must NOT synthesize a card for an unknown session — external sessions
    // stay off the board (the native engine has no external discovery by design).
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000001' // NOT in the map

    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(deltas).toHaveLength(0) // no-op
    expect(r.snapshotMap().has(id)).toBe(false) // NOT upserted (deliberate)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.path).toBe('(hook)')
    expect(logged?.code).toBe('hook_unknown_id')
    // STRUCTURAL: only {path, code} — no body/value can ride the record.
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  it('Story 6.3 — unknown session_id + removed → [] SILENTLY (idempotent removal, no log)', () => {
    // The stop/exit fast-removal (index.ts) usually beats the belt-and-suspenders
    // SessionEnd hook; the late hook removing an already-removed id must be the
    // "already gone" no-op — emit nothing AND log nothing (no hook_unknown_id noise).
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000002' // NOT in the map

    const deltas = r.applyHookStatus(id, { kind: 'removed' })
    expect(deltas).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
  })

  it('Story 6.3 — double removal: hook-removed twice emits ONE session.removed then []', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000003'
    r.upsertLaunched(launchedSession(id))

    const first = r.applyHookStatus(id, { kind: 'removed' })
    expect(first).toHaveLength(1)
    expect(first[0]?.event.type).toBe('session.removed')
    expect(r.snapshotMap().has(id)).toBe(false)

    const second = r.applyHookStatus(id, { kind: 'removed' })
    expect(second).toHaveLength(0) // idempotent
    expect(log).not.toHaveBeenCalled() // ...and quiet
  })

  it('a subsequent applyHookStatus TRANSITIONS the synthesized session (upsert-then-hook)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch02-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    // UserPromptSubmit → Working (NOT hook_unknown_id: the upsert made it known).
    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(deltas).toHaveLength(1)
    const evt = deltas[0]?.event
    expect(evt?.type).toBe('session.updated')
    if (evt?.type === 'session.updated') expect(evt.status).toBe('Working')
    expect(r.snapshotMap().get(id)?.status).toBe('Working')
  })
})

describe('reducer — renameSession (session-naming A2)', () => {
  const ID = 'launch01-0000-4000-8000-00000000000r'

  it('swaps sessionName ONLY and emits ONE epoch-framed session.updated', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(
      launchedSession(ID, { projectPath: '/home/op/proj', sessionName: 'proj', pid: 4242 })
    )
    // A hook moves it off Connecting, so the test proves the rename preserves a REAL status
    // rather than trivially preserving the synthesized default.
    r.applyHookStatus(ID, { kind: 'status', status: 'Working' })

    const deltas = r.renameSession(ID, 'deploy-prod')

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event).toEqual({
      type: 'session.updated',
      id: ID,
      sessionName: 'deploy-prod',
      projectPath: '/home/op/proj',
      status: 'Working'
    })
    expect(deltas[0]?.epoch).toBe(r.epoch())
    // Everything except the name survives — including the pid, which the delta never carries.
    const stored = r.snapshotMap().get(ID)
    expect(stored?.sessionName).toBe('deploy-prod')
    expect(stored?.status).toBe('Working')
    expect(stored?.projectPath).toBe('/home/op/proj')
    expect(stored?.pid).toBe(4242)
  })

  it('unknown id → [] + log { path: "(rename)", code: "rename_unknown_id" } (never synthesizes)', () => {
    const log = vi.fn()
    const r = createReducer({ now: () => FIXED_NOW, log })

    const deltas = r.renameSession('never-launched-id', 'whatever')

    expect(deltas).toEqual([])
    // A rename must NOT put a card on the board — that is the Story-3.3 ship gate. Mirrors the
    // hook_unknown_id no-op.
    expect(r.size()).toBe(0)
    expect(log).toHaveBeenCalledWith({ path: '(rename)', code: 'rename_unknown_id' })
  })

  it('NEVER logs the name — the unknown-id log carries a marker path and a code, nothing else', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const secret = 'client-acme-invoice-dispute'

    r.renameSession('never-launched-id', secret)

    // The name is operator content (zod-boundaries.md never-log-the-value). Assert on the WHOLE
    // serialized log call, so a future `log({ ...err, name })` cannot slip through.
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
  })

  it('does NOT reorder the board — the status is unchanged, so enteredColumnAt is never re-stamped', () => {
    // The reducer does not own enteredColumnAt (attention.ts stamps it on a COLUMN change), so the
    // guarantee this test can make at THIS layer is the precondition that makes it hold: a rename
    // emits an UNCHANGED status. If a future edit re-derived status here, the sort key would move.
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(launchedSession(ID, { sessionName: 'before' }))
    r.applyHookStatus(ID, { kind: 'status', status: 'WaitingForInput' })

    const [delta] = r.renameSession(ID, 'after')

    expect(delta?.event).toMatchObject({ type: 'session.updated', status: 'WaitingForInput' })
  })

  it('a rename racing a stop/exit that already removed the card is a quiet no-op', () => {
    const log = vi.fn()
    const r = createReducer({ now: () => FIXED_NOW, log })
    r.upsertLaunched(launchedSession(ID, { sessionName: 'gone-soon' }))
    r.applyHookStatus(ID, { kind: 'removed' })

    const deltas = r.renameSession(ID, 'too-late')

    expect(deltas).toEqual([])
    expect(r.size()).toBe(0)
    // It DOES log here (unlike the idempotent-removal path): a rename of a gone session is a
    // renderer/main disagreement worth a code, just never a resurrected card.
    expect(log).toHaveBeenCalledWith({ path: '(rename)', code: 'rename_unknown_id' })
  })

  it('renaming twice keeps the last name and emits one delta each time', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(launchedSession(ID, { sessionName: 'first' }))

    expect(r.renameSession(ID, 'second')).toHaveLength(1)
    expect(r.renameSession(ID, 'third')).toHaveLength(1)
    expect(r.snapshotMap().get(ID)?.sessionName).toBe('third')
    expect(r.size()).toBe(1)
  })
})

describe('setWorkspace', () => {
  const stored = {
    id: 's1',
    status: 'Working',
    projectPath: '/p',
    pid: 3,
    sessionName: 'n',
    workspaceId: 'w1',
    tagIds: [],
    templateId: null
  }

  it('emits one session.updated with the new workspace', () => {
    const reducer = createReducer({ now: () => 1 })
    reducer.upsertLaunched(stored)
    const deltas = reducer.setWorkspace('s1', 'w2', [])
    expect(deltas).toHaveLength(1)
    expect(reducer.snapshotMap().get('s1')?.workspaceId).toBe('w2')
  })

  it('changes NOTHING else — status, name, projectPath and pid survive', () => {
    const reducer = createReducer({ now: () => 1 })
    reducer.upsertLaunched(stored)
    reducer.setWorkspace('s1', 'w2', [])
    expect(reducer.snapshotMap().get('s1')).toEqual({ ...stored, workspaceId: 'w2' })
  })

  it('is a logged no-op for an unknown session id — never synthesizes a card', () => {
    const log = vi.fn()
    const reducer = createReducer({ now: () => 1, log })
    expect(reducer.setWorkspace('ghost', 'w2', [])).toEqual([])
    expect(reducer.size()).toBe(0)
    expect(log).toHaveBeenCalledWith({ path: '(set-workspace)', code: 'set_workspace_unknown_id' })
  })

  it('is a no-op when the workspace is unchanged', () => {
    const reducer = createReducer({ now: () => 1 })
    reducer.upsertLaunched(stored)
    expect(reducer.setWorkspace('s1', 'w1', [])).toEqual([])
  })

  it('carries the tag list the caller kept, in the SAME delta as the move (T-9)', () => {
    const reducer = createReducer({ now: () => 1 })
    reducer.upsertLaunched({ ...stored, tagIds: ['global', 'old-ws'] })
    expect(reducer.setWorkspace('s1', 'w2', ['global'])).toHaveLength(1)
    expect(reducer.snapshotMap().get('s1')?.tagIds).toEqual(['global'])
  })
})

describe('reducer — setTags (tags, spec §2.5)', () => {
  it('replaces the tags and changes nothing else', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(launchedSession('s1', { status: 'Working' }))
    expect(r.setTags('s1', ['t1', 't2'])).toHaveLength(1)
    expect(r.snapshotMap().get('s1')).toEqual(
      launchedSession('s1', { status: 'Working', tagIds: ['t1', 't2'] })
    )
  })

  it('an unchanged set, in any order, emits nothing', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(launchedSession('s1'))
    r.setTags('s1', ['a', 'b'])
    expect(r.setTags('s1', ['b', 'a'])).toEqual([])
  })

  it('is a logged no-op for an unknown id — never synthesizes a card', () => {
    const log = vi.fn()
    const r = createReducer({ now: () => FIXED_NOW, log })
    expect(r.setTags('ghost', ['t1'])).toEqual([])
    expect(r.size()).toBe(0)
    expect(log).toHaveBeenCalledWith({ path: '(set-tags)', code: 'set_tags_unknown_id' })
  })

  // Drift guard for spec §2.5 ("does not re-stamp `enteredColumnAt`"): a tag write must never
  // read as a column entry to the attention tracker, or it would reorder the board / fire rules.
  it('keeps enteredColumnAt — a tag write is not a column change (no reorder, no rule edge)', () => {
    let t = 100
    const r = createReducer({ now: () => t })
    const tracker = createAttentionTracker({ now: () => t })
    const route = (deltas: SessionDelta[]): void => {
      for (const d of deltas) tracker.onDelta(d, r.snapshotMap())
    }
    route(r.upsertLaunched(launchedSession('s1', { status: 'Working' })))
    t = 500
    route(r.setTags('s1', ['t1']))
    expect(tracker.enteredColumnAt('s1')).toBe(100)
  })
})

describe('reducer — markSeen (deterministic attention: the guarded YourTurn-to-idle demotion)', () => {
  it('demotes a YourTurn session to WaitingForInput and emits session.updated', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(launchedSession('a', { status: 'YourTurn' }))

    const deltas = r.markSeen('a')

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event).toMatchObject({
      type: 'session.updated',
      id: 'a',
      status: 'WaitingForInput'
    })
    expect(r.snapshotMap().get('a')?.status).toBe('WaitingForInput')
  })

  it('is a silent no-op for any non-YourTurn status (the race guard: seen can never hide a question/permission/work)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    for (const status of [
      'Working',
      'NeedsAttention',
      'NeedsPermission',
      'WaitingForInput',
      'Connecting'
    ]) {
      const id = 's-' + status
      r.upsertLaunched(launchedSession(id, { status }))
      expect(r.markSeen(id)).toEqual([])
      expect(r.snapshotMap().get(id)?.status).toBe(status)
    }
  })

  it('is a silent no-op for an unknown id (never synthesizes a card)', () => {
    const log = vi.fn()
    const r = createReducer({ now: () => FIXED_NOW, log })

    expect(r.markSeen('ghost')).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('a Stop AFTER a seen wins — the new turn re-raises YourTurn', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.upsertLaunched(launchedSession('a', { status: 'YourTurn' }))
    r.markSeen('a')

    const deltas = r.applyHookStatus('a', { kind: 'status', status: 'YourTurn' })

    expect(deltas[0]?.event).toMatchObject({ status: 'YourTurn' })
  })
})

describe('reducer — determinism + map hygiene', () => {
  it('the apply stamp is the injected now(), not the wall clock', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    expect(r.lastAppliedAt()).toBeNull() // nothing applied yet
    r.upsertLaunched(launchedSession('12340000-0000-4000-8000-000000000001'))
    expect(r.lastAppliedAt()).toBe(FIXED_NOW)
  })

  it('snapshotMap returns a DEFENSIVE COPY — mutating it never touches session truth', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = '56780000-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    const snap = r.snapshotMap()
    snap.delete(id)
    expect(r.snapshotMap().has(id)).toBe(true) // the authority is untouched
    expect(r.size()).toBe(1)
  })

  it('every delta rides the SAME constant epoch frame (the renderer stale-drop contract)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = '9abc0000-0000-4000-8000-000000000001'
    const a = r.upsertLaunched(launchedSession(id))
    const b = r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    const c = r.applyHookStatus(id, { kind: 'removed' })
    for (const d of [...a, ...b, ...c]) {
      expect(d.epoch).toBe(r.epoch())
    }
  })
})

describe('nameSyncPending — a rename waiting for claude', () => {
  const base: Session = {
    id: 's1',
    status: 'Working',
    projectPath: '/w',
    pid: 1,
    sessionName: 'old',
    workspaceId: 'default',
    tagIds: [],
    templateId: null
  }

  it('renameSession(id, name, true) marks the session pending and ships one delta', () => {
    const r = createReducer()
    r.upsertLaunched(base)
    const deltas = r.renameSession('s1', 'new', true)
    expect(deltas).toHaveLength(1)
    expect(r.snapshotMap().get('s1')?.sessionName).toBe('new')
    expect(r.snapshotMap().get('s1')?.nameSyncPending).toBe(true)
  })

  it('renameSession without the flag (the read-back) clears it', () => {
    const r = createReducer()
    r.upsertLaunched(base)
    r.renameSession('s1', 'new', true)
    r.renameSession('s1', 'claude said so')
    expect(r.snapshotMap().get('s1')?.nameSyncPending).toBe(false)
  })

  it('clearNameSyncPending ships a delta only when something was pending', () => {
    const r = createReducer()
    r.upsertLaunched(base)
    expect(r.clearNameSyncPending('s1')).toEqual([])
    r.renameSession('s1', 'new', true)
    expect(r.clearNameSyncPending('s1')).toHaveLength(1)
    expect(r.snapshotMap().get('s1')?.nameSyncPending).toBe(false)
    expect(r.clearNameSyncPending('unknown')).toEqual([])
  })
})
