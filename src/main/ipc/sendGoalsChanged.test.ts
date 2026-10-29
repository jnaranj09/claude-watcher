import { describe, it, expect, vi, afterEach } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import { sendGoalsChanged } from './sendGoalsChanged'
import type { GoalsView } from '../../shared/schemas/goal'

function fakeWc(destroyed = false): { wc: Electron.WebContents; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return { wc: { isDestroyed: () => destroyed, send } as unknown as Electron.WebContents, send }
}

const VIEW: GoalsView = {
  goals: [
    {
      id: 'g1',
      workspaceId: 'w1',
      name: 'Ship',
      defaultCwd: '/work',
      saveToFile: false,
      createdAt: 1
    }
  ],
  tasks: [],
  proposals: [],
  fileProblems: []
}

afterEach(() => vi.restoreAllMocks())

describe('sendGoalsChanged', () => {
  it('sends a valid view on goals:changed', () => {
    const { wc, send } = fakeWc()
    sendGoalsChanged(wc, VIEW)
    expect(send).toHaveBeenCalledWith(CH.goalsChanged, VIEW)
  })

  it('drops an invalid view with a path+code log that never carries the value', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wc, send } = fakeWc()
    const bad = {
      ...VIEW,
      goals: [{ ...VIEW.goals[0], name: 'SECRET-NAME', workspaceId: '' }]
    } as unknown as GoalsView
    sendGoalsChanged(wc, bad)
    expect(send).not.toHaveBeenCalled()
    const line = String(error.mock.calls[0]?.[0])
    expect(line).toContain('code=')
    expect(line).not.toContain('SECRET')
  })

  it('sends nothing to a destroyed window', () => {
    const { wc, send } = fakeWc(true)
    sendGoalsChanged(wc, VIEW)
    expect(send).not.toHaveBeenCalled()
  })
})
