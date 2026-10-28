// The sticky ask: a Stop ending in a `Needs you:` line holds the card on NeedsAttention through
// tool events, later Stops and monitor wake-ups, until the operator acts (spec 2026-10-23
// needs-you-marker, step 4).
import { describe, it, expect, vi } from 'vitest'
import { createReducer, OPERATOR_ORIGINS, type HookStatusChange } from './reducer'
import { launchedSession } from '../../__fixtures__/fakeSessions'

const ID = 'ask00001-0000-4000-8000-000000000001'

const MARKER_STOP: HookStatusChange = { kind: 'status', status: 'NeedsAttention', opensAsk: true }
const PLAIN_STOP: HookStatusChange = { kind: 'status', status: 'YourTurn' }
const MONITOR_STOP: HookStatusChange = { kind: 'status', status: 'Working' }
const PROMPT: HookStatusChange = { kind: 'status', status: 'Working', fromPrompt: true }
const ESC: HookStatusChange = { kind: 'status', status: 'WaitingForInput' }

function pre(toolUseId: string, toolName = 'Bash'): HookStatusChange {
  return { kind: 'status', status: 'Working', fromTool: true, toolName, toolUseId }
}

function post(toolUseId: string): HookStatusChange {
  return { kind: 'status', status: 'Working', fromTool: true, toolDone: true, toolUseId }
}

/** A reducer holding one session whose ask is open. The mod has reported an origin before (a
 *  `composer` prompt started the turn), so a later `UserPromptSubmit` waits for its origin. */
function askOpen(): ReturnType<typeof createReducer> {
  const r = createReducer({ now: () => 1 })
  r.upsertLaunched(launchedSession(ID))
  r.applyHookStatus(ID, PROMPT)
  r.promptOrigin(ID, 'composer')
  r.applyHookStatus(ID, MARKER_STOP)
  return r
}

function statusOf(r: ReturnType<typeof createReducer>): string | undefined {
  return r.snapshotMap().get(ID)?.status
}

describe('reducer — the sticky Needs you: ask', () => {
  it('the operator origins are composer and bridge', () => {
    expect([...OPERATOR_ORIGINS].sort()).toEqual(['bridge', 'composer'])
  })

  it('a marker Stop puts the card on NeedsAttention', () => {
    expect(statusOf(askOpen())).toBe('NeedsAttention')
  })

  it('tool events and later Stops keep the card on NeedsAttention while the ask is open', () => {
    const r = askOpen()
    const seen = [pre('t1'), post('t1'), MONITOR_STOP, PLAIN_STOP].map(
      (change) => r.applyHookStatus(ID, change)[0]?.event
    )
    expect(seen.map((evt) => (evt?.type === 'session.updated' ? evt.status : evt?.type))).toEqual([
      'NeedsAttention',
      'NeedsAttention',
      'NeedsAttention',
      'NeedsAttention'
    ])
  })

  it('a tool event under the ask names no pending tool', () => {
    const r = askOpen()
    r.applyHookStatus(ID, pre('t1'))
    expect(r.snapshotMap().get(ID)?.pendingToolName).toBeUndefined()
  })

  it('a monitor wake-up origin changes nothing', () => {
    const r = askOpen()
    expect(r.promptOrigin(ID, 'task-notification')).toEqual([])
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('a wake-up prompt keeps the ask: its origin is not the operator', () => {
    const r = askOpen()
    r.applyHookStatus(ID, PROMPT)
    r.promptOrigin(ID, 'task-notification')
    r.applyHookStatus(ID, pre('t1'))
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('order A: the prompt hook holds the ask, then the composer origin clears it to Working', () => {
    const r = askOpen()
    r.applyHookStatus(ID, PROMPT)
    expect(statusOf(r)).toBe('NeedsAttention')
    const deltas = r.promptOrigin(ID, 'composer')
    expect(deltas[0]?.event).toMatchObject({ type: 'session.updated', status: 'Working' })
    expect(statusOf(r)).toBe('Working')
  })

  it('order B: the composer origin clears to Working, and the prompt hook stays Working', () => {
    const r = askOpen()
    r.promptOrigin(ID, 'composer')
    expect(statusOf(r)).toBe('Working')
    r.applyHookStatus(ID, PROMPT)
    expect(statusOf(r)).toBe('Working')
  })

  it('a bridge origin (Remote Control) clears the ask too', () => {
    const r = askOpen()
    r.promptOrigin(ID, 'bridge')
    r.applyHookStatus(ID, pre('t1'))
    expect(statusOf(r)).toBe('Working')
  })

  it('the cleared ask stays cleared: the next tool event is Working', () => {
    const r = askOpen()
    r.applyHookStatus(ID, PROMPT)
    r.promptOrigin(ID, 'composer')
    r.applyHookStatus(ID, pre('t1'))
    expect(statusOf(r)).toBe('Working')
  })

  it('with no origin ever reported, the prompt hook clears the ask (fail open)', () => {
    const r = createReducer({ now: () => 1 })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, MARKER_STOP)
    r.applyHookStatus(ID, PROMPT)
    expect(statusOf(r)).toBe('Working')
  })

  it('an operator origin with no ask open changes nothing (the hook owns the status)', () => {
    const r = createReducer({ now: () => 1 })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, PLAIN_STOP)
    expect(r.promptOrigin(ID, 'composer')).toEqual([])
    expect(statusOf(r)).toBe('YourTurn')
  })

  it('a permission dialog wins over the ask, and its close returns the card to NeedsAttention', () => {
    const r = askOpen()
    r.applyHookStatus(ID, pre('t2'))
    r.applyHookStatus(ID, {
      kind: 'status',
      status: 'NeedsPermission',
      toolName: 'Bash',
      opensPrompt: true
    })
    expect(statusOf(r)).toBe('NeedsPermission')
    r.applyHookStatus(ID, post('t2'))
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('Esc (WaitingForInput) clears the ask: the next plain Stop is YourTurn', () => {
    const r = askOpen()
    r.applyHookStatus(ID, ESC)
    r.applyHookStatus(ID, PLAIN_STOP)
    expect(statusOf(r)).toBe('YourTurn')
  })

  it('a question Stop without the marker is not sticky', () => {
    const r = createReducer({ now: () => 1 })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, { kind: 'status', status: 'NeedsAttention' })
    r.applyHookStatus(ID, pre('t1'))
    expect(statusOf(r)).toBe('Working')
  })

  it('an AskUserQuestion answered in a later turn clears the ask', () => {
    const r = askOpen()
    r.applyHookStatus(ID, {
      kind: 'status',
      status: 'NeedsAttention',
      fromTool: true,
      toolName: 'AskUserQuestion',
      toolUseId: 'q1',
      opensPrompt: true
    })
    r.applyHookStatus(ID, post('q1'))
    r.applyHookStatus(ID, pre('t3'))
    expect(statusOf(r)).toBe('Working')
  })

  it('another closed prompt (a permission) does not clear the ask', () => {
    const r = askOpen()
    r.applyHookStatus(ID, pre('t2'))
    r.applyHookStatus(ID, {
      kind: 'status',
      status: 'NeedsPermission',
      toolName: 'Bash',
      opensPrompt: true
    })
    r.applyHookStatus(ID, post('t2'))
    r.applyHookStatus(ID, pre('t3'))
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('an answered elicitation clears the ask', () => {
    const r = askOpen()
    r.applyHookStatus(ID, { kind: 'status', status: 'NeedsAttention', fromTool: true })
    r.applyHookStatus(ID, { kind: 'status', status: 'Working', fromTool: true, answered: true })
    expect(statusOf(r)).toBe('Working')
  })

  it('a seen does not demote a held ask', () => {
    const r = askOpen()
    expect(r.markSeen(ID)).toEqual([])
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('a seen releases the hold: the next wake-up turn decides', () => {
    const r = askOpen()
    r.markSeen(ID)
    r.applyHookStatus(ID, PROMPT)
    r.promptOrigin(ID, 'scheduled-trigger')
    expect(statusOf(r)).toBe('Working')
    r.applyHookStatus(ID, MONITOR_STOP)
    expect(statusOf(r)).toBe('Working')
  })

  it('unseen, the ask holds through wake-up turns', () => {
    const r = askOpen()
    r.applyHookStatus(ID, PROMPT)
    r.promptOrigin(ID, 'scheduled-trigger')
    r.applyHookStatus(ID, MONITOR_STOP)
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('a new marker after a seen opens a fresh hold', () => {
    const r = askOpen()
    r.markSeen(ID)
    r.applyHookStatus(ID, MARKER_STOP)
    r.applyHookStatus(ID, MONITOR_STOP)
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('removal forgets the ask and the origin: promptOrigin afterwards returns nothing', () => {
    const r = askOpen()
    r.applyHookStatus(ID, { kind: 'removed' })
    expect(r.promptOrigin(ID, 'composer')).toEqual([])
  })

  it('removal forgets the reported origin: a relaunch under the same id fails open again', () => {
    const r = askOpen()
    r.applyHookStatus(ID, { kind: 'removed' })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, MARKER_STOP)
    r.applyHookStatus(ID, PROMPT)
    expect(statusOf(r)).toBe('Working')
  })

  it('removal forgets the ask: a relaunch under the same id is not held', () => {
    const r = askOpen()
    r.applyHookStatus(ID, { kind: 'removed' })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, pre('t1'))
    expect(statusOf(r)).toBe('Working')
  })

  it('an origin for an unknown id is not remembered for a later launch under that id', () => {
    const r = createReducer({ now: () => 1 })
    r.promptOrigin(ID, 'task-notification')
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, MARKER_STOP)
    r.applyHookStatus(ID, PROMPT)
    expect(statusOf(r)).toBe('Working')
  })

  it('promptOrigin for an unknown id returns nothing and logs nothing', () => {
    const log = vi.fn()
    const r = createReducer({ now: () => 1, log })
    expect(r.promptOrigin('ghost', 'composer')).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })
})

// Running background work is never idle (owner, 2026-10-26). The ask also ends when claude starts
// background work of its own: it was unblocked some other way (a chat, a ticket, a coworker).
describe('reducer — the sticky ask and running background work', () => {
  const stopWith = (status: string, taskIds: string[], opensAsk = false): HookStatusChange =>
    opensAsk
      ? { kind: 'status', status, taskIds, opensAsk: true }
      : { kind: 'status', status, taskIds }
  const INTERRUPT: HookStatusChange = { kind: 'status', status: 'WaitingForInput', interrupt: true }

  /** The D8NR shape: the ask opens while the chat monitor `mon` already runs, and the mod reports
   *  origins (so a wake-up prompt waits for its own). */
  function askWithMonitor(): ReturnType<typeof createReducer> {
    const r = createReducer({ now: () => 1 })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, PROMPT)
    r.promptOrigin(ID, 'composer')
    r.applyHookStatus(ID, stopWith('NeedsAttention', ['mon'], true))
    return r
  }

  it('a wake-up turn that only keeps the same work running holds the ask', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, PROMPT)
    r.promptOrigin(ID, 'task-notification')
    r.applyHookStatus(ID, pre('chat-post'))
    r.applyHookStatus(ID, stopWith('Working', ['mon']))
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('a Stop with new background work clears the ask: claude went back to work by itself', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, stopWith('Working', ['mon', 'sleep150']))
    expect(statusOf(r)).toBe('Working')
    r.applyHookStatus(ID, stopWith('YourTurn', []))
    expect(statusOf(r)).toBe('YourTurn')
  })

  it('work that only finishes never clears the ask', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, stopWith('YourTurn', []))
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('a repeated marker takes a new snapshot: work started before it does not clear the ask', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, stopWith('NeedsAttention', ['mon', 'poll'], true))
    r.applyHookStatus(ID, stopWith('Working', ['mon', 'poll']))
    expect(statusOf(r)).toBe('NeedsAttention')
  })

  it('an interrupt with work running goes to Working, not idle, and clears the ask', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, INTERRUPT)
    expect(statusOf(r)).toBe('Working')
    r.applyHookStatus(ID, stopWith('YourTurn', []))
    expect(statusOf(r)).toBe('YourTurn')
  })

  it('an interrupt with no work running at the last Stop goes idle', () => {
    const r = createReducer({ now: () => 1 })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, stopWith('Working', ['dev']))
    r.applyHookStatus(ID, stopWith('YourTurn', []))
    r.applyHookStatus(ID, INTERRUPT)
    expect(statusOf(r)).toBe('WaitingForInput')
  })

  it('a /clear (no interrupt) stays idle even with work running', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, ESC)
    expect(statusOf(r)).toBe('WaitingForInput')
  })

  it('a /clear forgets the old work: a later interrupt goes idle', () => {
    const r = askWithMonitor()
    r.applyHookStatus(ID, ESC)
    r.applyHookStatus(ID, PROMPT)
    r.applyHookStatus(ID, INTERRUPT)
    expect(statusOf(r)).toBe('WaitingForInput')
  })
})
