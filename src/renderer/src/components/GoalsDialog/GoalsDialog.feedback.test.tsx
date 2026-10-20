// Action feedback (spec 2026-09-29 §2.5) — a goal save main refused says so in the dialog's ONE
// message slot, in the operator's words, and the goal is not shown as saved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalsDialog } from './GoalsDialog'
import { goalsStore } from '../../stores/goalsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'

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
  it('a refused save shows STORE_WRITE_FAILED_COPY in the message slot', async () => {
    const user = userEvent.setup()
    unmount = render(<GoalsDialog onClose={() => {}} />).unmount
    await user.click(screen.getByRole('button', { name: '+ New goal' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ship v2')
    await user.click(screen.getByTestId('goal-submit'))
    expect(screen.getByTestId('goals-error')).toHaveTextContent(STORE_WRITE_FAILED_COPY)
    expect(screen.queryByTestId('goals-success')).not.toBeInTheDocument()
  })
})
