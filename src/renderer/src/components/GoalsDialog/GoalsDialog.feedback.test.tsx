// Action feedback (spec 2026-09-29 §2.5) — a goal save main refused says so in the dialog's error
// toast, in the operator's words, and the goal is not shown as saved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalsDialog } from './GoalsDialog'
import { deferred } from '../../test/deferred'
import { goalsStore } from '../../stores/goalsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { dialogToast } from '../../test/toasts'

let unmount: (() => void) | undefined

beforeEach(() => {
  ;(window as unknown as { goals: unknown }).goals = {
    saveGoal: vi.fn(() =>
      Promise.reject(
        new Error("Error invoking remote method 'goals:save-goal': Error: store_write_failed")
      )
    ),
    onChanged: vi.fn(() => () => {})
  }
  act(() => {
    goalsStore.setState({ goals: [], tasks: [], loaded: true, loadFailed: false })
    workspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
      activeId: 'w1',
      loaded: true
    })
  })
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    goalsStore.setState({ goals: [], tasks: [], loaded: false, loadFailed: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
  })
})

describe('GoalsDialog — feedback', () => {
  it('a refused save shows STORE_WRITE_FAILED_COPY in an error toast', async () => {
    const user = userEvent.setup()
    unmount = render(<GoalsDialog onClose={() => {}} />).unmount
    await user.click(screen.getByRole('button', { name: '+ New goal' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ship v2')
    await user.click(screen.getByTestId('goal-submit'))
    expect(dialogToast('goals')).toMatchObject({ kind: 'error', title: STORE_WRITE_FAILED_COPY })
  })

  it('a failed task add shows the error, and the retry clears it before trying', async () => {
    const user = userEvent.setup()
    const task = {
      id: 't-new',
      workspaceId: 'w1',
      goalId: 'g1',
      title: 'Cut the tag',
      status: 'open',
      sessionIds: [],
      createdAt: 1,
      doneAt: null,
      doneBy: null,
      check: null,
      leftWith: null,
      lastSeenAt: null,
      report: null,
      originSessionId: null,
      folder: null,
      touchedBy: []
    }
    const goal = {
      id: 'g1',
      workspaceId: 'w1',
      name: 'Ship v2',
      defaultCwd: null,
      saveToFile: false,
      createdAt: 1,
      memorySessionIds: []
    }
    const retry = deferred<unknown>()
    const saveTask = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Error invoking remote method 'goals:save-task': Error: store_write_failed")
      )
      .mockReturnValueOnce(retry.promise)
    ;(window as unknown as { goals: unknown }).goals = {
      saveTask,
      onChanged: vi.fn(() => () => {})
    }
    act(() => goalsStore.setState({ goals: [goal], tasks: [] }))
    unmount = render(<GoalsDialog onClose={() => {}} />).unmount
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.type(screen.getByRole('textbox', { name: '+ New task' }), 'Cut the tag{Enter}')
    expect(dialogToast('goals')).toMatchObject({ kind: 'error', title: STORE_WRITE_FAILED_COPY })
    await user.keyboard('{Enter}')
    // The retry is still in flight: the old error is already gone.
    expect(saveTask).toHaveBeenCalledTimes(2)
    expect(dialogToast('goals')).toBeUndefined()
    await act(async () => {
      retry.resolve({ saved: task, goals: [goal], tasks: [task], proposals: [], fileProblems: [] })
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Done Cut the tag' })).toBeInTheDocument()
  })
})
