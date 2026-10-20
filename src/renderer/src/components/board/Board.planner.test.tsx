// Board — a planner card (spec 2026-10-19 goals, "Plan with Claude"): the planner is a normal
// card. Its proposal waits in the Goals sheet, and the card shows nothing new for it.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { Board } from './Board'
import { boardStore } from '../../stores/boardStore'
import { goalsStore } from '../../stores/goalsStore'
import { watchUpdated } from '../../../../__fixtures__/watchEvents'
import type { GoalsView } from '../../../../shared/ipc/contract'

const EMPTY: GoalsView = { goals: [], tasks: [], proposals: [] }

const WITH_PROPOSAL: GoalsView = {
  goals: [{ id: 'g1', workspaceId: 'default', name: 'Chores', defaultCwd: null, createdAt: 1 }],
  tasks: [
    {
      id: 't1',
      workspaceId: 'default',
      goalId: 'g1',
      title: 'Water plants',
      status: 'open',
      sessionIds: [],
      createdAt: 1,
      doneAt: null,
      doneBy: null
    }
  ],
  proposals: [
    { plannerSessionId: 'planner-1', goalId: 'g1', groups: [{ taskIds: ['t1'], note: 'n' }] }
  ]
}

afterEach(() => {
  act(() => {
    goalsStore.getState().hydrate(EMPTY)
    boardStore.setState({ sessionsById: {}, epoch: 0, coldLoaded: false, selectedId: null })
  })
})

describe('Board — a planner card', () => {
  it('the planner card shows nothing new while its proposal waits in the sheet', () => {
    ;(window as unknown as { watch: unknown }).watch = {
      onEvents: () => () => {},
      onStatus: () => () => {}
    }
    ;(window as unknown as { attention: unknown }).attention = {
      onActivate: () => () => {},
      onReminder: () => () => {}
    }
    boardStore
      .getState()
      .applyWatchEvent(watchUpdated(1, 'planner-1', 'idle', 100, { status: 'WaitingForInput' }))
    const { unmount } = render(<Board />)
    const card = (): string => screen.getByRole('button', { name: /s-planner-1/ }).outerHTML
    const before = card()
    act(() => goalsStore.getState().hydrate(WITH_PROPOSAL))
    expect(card()).toBe(before)
    expect(screen.queryByTestId('goal-line')).not.toBeInTheDocument()
    unmount()
  })
})
