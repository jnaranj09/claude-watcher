// UX-12 / R29 — a notification click raises the window FIRST, then pushes the id so the renderer
// opens the session. A raise failure never stops the push.
import { describe, it, expect } from 'vitest'
import { createNotificationActivate, type NotificationActivateDeps } from './notificationActivate'
import type { AttentionActivatePayload } from '../../shared/ipc/contract'

const ID = 'ffff1111-0000-4000-8000-000000000001'

function setup(over: Partial<NotificationActivateDeps> = {}): {
  activate: (id: string) => void
  calls: string[]
  sent: AttentionActivatePayload[]
  logs: string[]
} {
  const calls: string[] = []
  const sent: AttentionActivatePayload[] = []
  const logs: string[] = []
  const activate = createNotificationActivate({
    isDestroyed: () => false,
    raise: () => calls.push('raise'),
    send: (p) => {
      calls.push('send')
      sent.push(p)
    },
    log: (m) => logs.push(m),
    ...over
  })
  return { activate, calls, sent, logs }
}

describe('createNotificationActivate (UX-12 / R29)', () => {
  it('raises the window, THEN pushes the id', () => {
    const { activate, calls, sent } = setup()
    activate(ID)
    expect(calls).toEqual(['raise', 'send'])
    expect(sent).toEqual([{ id: ID }])
  })

  it('a raise that throws still pushes the id and logs a code only', () => {
    const { activate, sent, logs } = setup({
      raise: () => {
        throw new Error(`boom ${ID}`)
      }
    })
    activate(ID)
    expect(sent).toEqual([{ id: ID }])
    expect(logs).toEqual(['[claude-watcher][notify] code=activate_raise_failed'])
  })

  it('a destroyed window: no raise, no push', () => {
    const { activate, calls } = setup({ isDestroyed: () => true })
    activate(ID)
    expect(calls).toEqual([])
  })

  it('a blank id is dropped at source and logged by path + code', () => {
    const { activate, sent, logs } = setup()
    activate('')
    expect(sent).toEqual([])
    expect(logs).toEqual(['[c9watch][attention] dropped attention:activate path=id code=too_small'])
  })
})
