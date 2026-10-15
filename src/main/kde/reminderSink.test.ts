// F1 (final-review fix wave) — the reminder SINK, extracted from src/main/index.ts so the
// production wiring (the launched gate, the ReminderInput shape, the isDestroyed check, the
// validate-at-source send) is exercised by a real test instead of a copy that lives only in
// the pipeline test's fixture. Byte-for-byte the same behavior the inline callback had.
import { describe, it, expect } from 'vitest'
import { createReminderSink } from './reminderSink'
import type { ReminderInput, AttentionNotifier } from './notifications'
import type { AttentionReminderPayload } from '../../shared/ipc/contract'
import { launchedSession } from '../../__fixtures__/fakeSessions'

const ID = 'dddd5555-0000-4000-8000-000000000001'

/** A recording fake of the one notifier method the sink uses. */
function fakeNotifier(): { notifier: Pick<AttentionNotifier, 'remind'>; calls: ReminderInput[] } {
  const calls: ReminderInput[] = []
  return { notifier: { remind: (input) => calls.push(input) }, calls }
}

function setup(overrides: {
  isLaunched?: (id: string) => boolean
  isViewing?: (id: string) => boolean
  isDestroyed?: () => boolean
}): {
  sink: ReturnType<typeof createReminderSink>
  remindCalls: ReminderInput[]
  sendCalls: AttentionReminderPayload[]
  logs: string[]
} {
  const { notifier, calls: remindCalls } = fakeNotifier()
  const sendCalls: AttentionReminderPayload[] = []
  const logs: string[] = []
  const sink = createReminderSink({
    isLaunched: overrides.isLaunched ?? (() => true),
    isViewing: overrides.isViewing ?? (() => false),
    notifier,
    send: (payload) => sendCalls.push(payload),
    isDestroyed: overrides.isDestroyed ?? (() => false),
    log: (message) => logs.push(message)
  })
  return { sink, remindCalls, sendCalls, logs }
}

describe('createReminderSink — the extracted production remind callback (F1)', () => {
  it('a launched session: notifier.remind is called with the ReminderInput, and send gets { id }', () => {
    const { sink, remindCalls, sendCalls } = setup({})
    const session = launchedSession(ID, { status: 'NeedsPermission', pendingToolName: 'Bash' })

    sink(session, { waitedMs: 120_000 })

    expect(remindCalls).toEqual([
      {
        id: ID,
        sessionName: session.sessionName,
        projectPath: session.projectPath,
        status: session.status,
        waitedMs: 120_000,
        pendingToolName: 'Bash'
      }
    ])
    expect(sendCalls).toEqual([{ id: ID }])
  })

  it('pendingToolName is passed through only when the session has one', () => {
    const { sink, remindCalls } = setup({})
    const session = launchedSession(ID, { status: 'NeedsAttention' })

    sink(session, { waitedMs: 60_000 })

    expect(remindCalls).toHaveLength(1)
    expect(remindCalls[0]).not.toHaveProperty('pendingToolName')
  })

  it('an external (non-launched) session: neither notifier.remind nor send is called', () => {
    const { sink, remindCalls, sendCalls } = setup({ isLaunched: () => false })
    const session = launchedSession(ID, { status: 'NeedsPermission' })

    sink(session, { waitedMs: 60_000 })

    expect(remindCalls).toHaveLength(0)
    expect(sendCalls).toHaveLength(0)
  })

  it('a destroyed window: notifier.remind still fires (the OS popup), but send does not', () => {
    const { sink, remindCalls, sendCalls } = setup({ isDestroyed: () => true })
    const session = launchedSession(ID, { status: 'NeedsPermission' })

    sink(session, { waitedMs: 60_000 })

    expect(remindCalls).toHaveLength(1)
    expect(sendCalls).toHaveLength(0)
  })

  it('an id that fails AttentionReminderSchema: send is not called, and the log is path + code only', () => {
    const { sink, sendCalls, logs } = setup({})
    const session = launchedSession('', { status: 'NeedsPermission' })

    sink(session, { waitedMs: 60_000 })

    expect(sendCalls).toHaveLength(0)
    expect(logs).toEqual([
      '[claude-watcher][reminders] dropped attention:reminder path=id code=too_small'
    ])
  })

  it('the session the operator is looking at gets no popup and no sound push (UX-13)', () => {
    const { sink, remindCalls, sendCalls } = setup({ isViewing: (id) => id === ID })
    sink(launchedSession(ID, { status: 'NeedsPermission' }), { waitedMs: 120_000 })
    expect(remindCalls).toEqual([])
    expect(sendCalls).toEqual([])
  })
})
