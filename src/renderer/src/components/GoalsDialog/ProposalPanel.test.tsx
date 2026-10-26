// Goals — "Plan with Claude" in the sheet (spec 2026-10-19): the button, and a planner's proposal
// under the goal's tasks (one row per session, move a task with a Select, drop a row, Accept /
// Reject). The real goalsStore and dialog run; only the IPC bridge is faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalsDialog } from './GoalsDialog'
import { goalsStore } from '../../stores/goalsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { GoalsView, Proposal, Task } from '../../../../shared/ipc/contract'
import { dialogToast } from '../../test/toasts'

const task = (id: string, title: string, over: Partial<Task> = {}): Task => ({
  id,
  workspaceId: 'w1',
  goalId: 'g1',
  title,
  status: 'open',
  sessionIds: [],
  createdAt: 1,
  doneAt: null,
  doneBy: null,
  ...over
})

const PROPOSAL: Proposal = {
  plannerSessionId: 'planner-1',
  goalId: 'g1',
  groups: [
    { taskIds: ['t1', 't2'], note: 'Small chores together' },
    { taskIds: ['t3'], note: 'The big one alone' }
  ]
}

function viewWith(proposals: Proposal[]): GoalsView {
  return {
    goals: [{ id: 'g1', workspaceId: 'w1', name: 'Chores', defaultCwd: '/home/j', createdAt: 1 }],
    tasks: [task('t1', 'Water plants'), task('t2', 'Take out trash'), task('t3', 'Clean garage')],
    proposals
  }
}

let bridge: {
  plan: ReturnType<typeof vi.fn>
  decideProposal: ReturnType<typeof vi.fn>
}
let unmount: (() => void) | undefined

async function openGoal(proposals: Proposal[], over: Partial<typeof bridge> = {}): Promise<void> {
  const view = viewWith(proposals)
  bridge = {
    plan: vi.fn(() => Promise.resolve({ terminalIds: ['term-p'] })),
    decideProposal: vi.fn(() =>
      Promise.resolve({ terminalIds: ['term-1', 'term-2'], ...viewWith([]) })
    ),
    ...over
  }
  ;(window as unknown as { goals: unknown }).goals = {
    ...bridge,
    list: vi.fn(() => Promise.resolve(view)),
    onChanged: vi.fn(() => () => {})
  }
  act(() => goalsStore.getState().hydrate(view))
  unmount = render(<GoalsDialog onClose={() => {}} />).unmount
  await userEvent.setup().click(screen.getByTestId('goal-select-g1'))
}

beforeEach(() => {
  act(() =>
    workspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
      activeId: 'w1',
      loaded: true
    })
  )
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    goalsStore.setState({ goals: [], tasks: [], proposals: [], loaded: false, loadFailed: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
  })
  vi.restoreAllMocks()
})

describe('ProposalPanel', () => {
  it('shows one row per session with its note and task titles, under the tasks', async () => {
    await openGoal([PROPOSAL])
    const panel = screen.getByTestId('proposal-planner-1')
    const rows = within(panel).getAllByTestId(/^proposal-row-/)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Session 1')
    expect(rows[0]).toHaveTextContent('Small chores together')
    expect(rows[0]).toHaveTextContent('Water plants')
    expect(rows[0]).toHaveTextContent('Take out trash')
    expect(rows[1]).toHaveTextContent('The big one alone')
    expect(rows[1]).toHaveTextContent('Clean garage')
    const list = screen.getByTestId('task-list')
    expect(list.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(panel).getByRole('switch', { name: 'Claude can mark tasks done' })).toBeChecked()
  })

  it('moving a task to row 2 and accepting sends the edited groups', async () => {
    const user = userEvent.setup()
    await openGoal([PROPOSAL])
    await user.click(screen.getByRole('button', { name: 'Move Take out trash' }))
    await user.click(screen.getByTestId('proposal-move-t2-option-1'))
    const rows = screen.getAllByTestId(/^proposal-row-/)
    expect(rows[1]).toHaveTextContent('Take out trash')
    await user.click(screen.getByRole('switch', { name: 'Claude can mark tasks done' }))
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(bridge.decideProposal).toHaveBeenCalledWith({
      plannerSessionId: 'planner-1',
      decision: 'accept',
      groups: [{ taskIds: ['t1'] }, { taskIds: ['t3', 't2'] }],
      markDone: false
    })
    expect(dialogToast('goals')).toMatchObject({ kind: 'success', title: 'Sessions started.' })
    // Main's answer carries no proposal any more: the panel goes.
    expect(screen.queryByTestId('proposal-planner-1')).not.toBeInTheDocument()
  })

  it('a row whose last task moves away is dropped; Remove drops a row; Accept sends what is left', async () => {
    const user = userEvent.setup()
    await openGoal([PROPOSAL])
    await user.click(screen.getByRole('button', { name: 'Move Clean garage' }))
    await user.click(screen.getByTestId('proposal-move-t3-option-0'))
    expect(screen.getAllByTestId(/^proposal-row-/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Remove session 1' }))
    expect(screen.queryAllByTestId(/^proposal-row-/)).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
  })

  it('a task closed since the proposal is left out of the rows and of Accept', async () => {
    const user = userEvent.setup()
    await openGoal([PROPOSAL])
    act(() =>
      goalsStore.getState().hydrate({
        ...viewWith([PROPOSAL]),
        tasks: [
          task('t1', 'Water plants', { status: 'done' }),
          task('t2', 'Take out trash'),
          task('t3', 'Clean garage')
        ]
      })
    )
    expect(screen.getByTestId('proposal-planner-1')).not.toHaveTextContent('Water plants')
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(bridge.decideProposal).toHaveBeenCalledWith(
      expect.objectContaining({ groups: [{ taskIds: ['t2'] }, { taskIds: ['t3'] }] })
    )
  })

  it('Reject sends reject and starts nothing', async () => {
    const user = userEvent.setup()
    await openGoal([PROPOSAL], {
      decideProposal: vi.fn(() => Promise.resolve({ terminalIds: [], ...viewWith([]) }))
    })
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(bridge.decideProposal).toHaveBeenCalledWith({
      plannerSessionId: 'planner-1',
      decision: 'reject'
    })
    expect(screen.queryByTestId('proposal-planner-1')).not.toBeInTheDocument()
  })

  it('a refused Accept keeps the panel and says why on the message line', async () => {
    const user = userEvent.setup()
    await openGoal([PROPOSAL], {
      decideProposal: vi.fn(() =>
        Promise.reject(
          new Error("Error invoking remote method 'goals:decide-proposal': Error: task_not_found")
        )
      )
    })
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(dialogToast('goals')).toMatchObject({
      kind: 'error',
      title: 'Could not start sessions.'
    })
    expect(screen.getByTestId('proposal-planner-1')).toBeInTheDocument()
  })

  it('no proposal for this goal: no panel', async () => {
    await openGoal([{ ...PROPOSAL, goalId: 'other' }])
    expect(screen.queryByTestId('proposal-planner-1')).not.toBeInTheDocument()
  })
})

describe('Plan with Claude', () => {
  it('starts a planner on the goal and says so; the view stays on the sheet', async () => {
    const user = userEvent.setup()
    await openGoal([])
    await user.click(screen.getByRole('button', { name: 'Plan with Claude' }))
    expect(bridge.plan).toHaveBeenCalledWith('g1')
    expect(dialogToast('goals')).toMatchObject({ kind: 'success', title: 'Planner started.' })
  })

  it('a hook port that is not ours says planning needs session status', async () => {
    const user = userEvent.setup()
    await openGoal([], {
      plan: vi.fn(() =>
        Promise.reject(
          new Error("Error invoking remote method 'goals:plan': Error: hooks_unavailable")
        )
      )
    })
    await user.click(screen.getByRole('button', { name: 'Plan with Claude' }))
    expect(dialogToast('goals')).toMatchObject({
      kind: 'error',
      title: 'Could not plan with Claude: session status is off.'
    })
  })

  it('a cancelled folder pick says nothing', async () => {
    const user = userEvent.setup()
    await openGoal([], {
      plan: vi.fn(() =>
        Promise.reject(
          new Error("Error invoking remote method 'goals:plan': Error: launch_cancelled")
        )
      )
    })
    await user.click(screen.getByRole('button', { name: 'Plan with Claude' }))
    expect(bridge.plan).toHaveBeenCalled()
    expect(dialogToast('goals')).toBeUndefined()
  })
})
