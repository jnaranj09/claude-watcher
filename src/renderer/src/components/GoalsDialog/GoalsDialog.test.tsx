// Goals — the sheet where goals and tasks are planned by hand (spec 2026-10-19 "Plan by hand").
// The real goalsStore and the real dialog run; only the IPC bridge is faked, by a small stand-in
// for main that keeps the view it answers with.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalsDialog } from './GoalsDialog'
import { goalsStore } from '../../stores/goalsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type {
  Goal,
  GoalSaveRequest,
  GoalsView,
  Task,
  TaskSaveRequest,
  TaskStatus
} from '../../../../shared/ipc/contract'
import { dialogToast } from '../../test/toasts'

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  workspaceId: 'w1',
  name: 'Ship v2',
  defaultCwd: null,
  createdAt: 1,
  ...over
})
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  workspaceId: 'w1',
  goalId: 'g1',
  title: 'Write the spec',
  status: 'open',
  sessionIds: [],
  createdAt: 1,
  doneAt: null,
  doneBy: null,
  ...over
})

let view: GoalsView
let bridge: Record<string, ReturnType<typeof vi.fn>>

function installBridge(initial: GoalsView): void {
  view = initial
  const answer = (): Promise<GoalsView> => Promise.resolve(view)
  bridge = {
    list: vi.fn(answer),
    saveGoal: vi.fn((req: GoalSaveRequest) => {
      const saved = goal({ id: req.id ?? 'g-new', name: req.name, workspaceId: req.workspaceId })
      view = { ...view, goals: [...view.goals.filter((g) => g.id !== saved.id), saved] }
      return Promise.resolve({ saved, ...view })
    }),
    deleteGoal: vi.fn((id: string) => {
      view = {
        ...view,
        goals: view.goals.filter((g) => g.id !== id),
        tasks: view.tasks.filter((t) => t.goalId !== id)
      }
      return answer()
    }),
    pickFolder: vi.fn((goalId: string) => {
      view = {
        ...view,
        goals: view.goals.map((g) => (g.id === goalId ? { ...g, defaultCwd: '/home/j/app' } : g))
      }
      return answer()
    }),
    clearFolder: vi.fn((goalId: string) => {
      view = {
        ...view,
        goals: view.goals.map((g) => (g.id === goalId ? { ...g, defaultCwd: null } : g))
      }
      return answer()
    }),
    saveTask: vi.fn((req: TaskSaveRequest) => {
      const saved = task({ id: 't-new', goalId: req.goalId, title: req.title })
      view = { ...view, tasks: [...view.tasks, saved] }
      return Promise.resolve({ saved, ...view })
    }),
    deleteTask: vi.fn(answer),
    setTaskStatus: vi.fn((id: string, status: TaskStatus) => {
      view = { ...view, tasks: view.tasks.map((t) => (t.id === id ? { ...t, status } : t)) }
      return answer()
    }),
    linkTask: vi.fn(answer),
    unlinkTask: vi.fn(answer),
    start: vi.fn(() => Promise.resolve({ terminalIds: ['term-1'] })),
    onChanged: vi.fn(() => () => {})
  }
  ;(window as unknown as { goals: unknown }).goals = bridge
  act(() =>
    goalsStore.setState({ goals: view.goals, tasks: view.tasks, loaded: true, loadFailed: false })
  )
}

let unmount: (() => void) | undefined

beforeEach(() => {
  act(() =>
    workspacesStore.setState({
      workspaces: [
        { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
        { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
      ],
      activeId: 'w1',
      loaded: true
    })
  )
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    goalsStore.setState({ goals: [], tasks: [], loaded: false, loadFailed: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
  })
  vi.restoreAllMocks()
})

function open(initial: GoalsView = { goals: [], tasks: [], proposals: [] }): void {
  installBridge(initial)
  unmount = render(<GoalsDialog onClose={() => {}} />).unmount
}

describe('GoalsDialog', () => {
  it('opens on Daily tasks, every time', () => {
    open()
    expect(screen.getByTestId('goal-select-daily')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('goal-daily-pane')).toBeInTheDocument()
  })

  it('+ New goal opens the goal form; Save creates the goal and selects it', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: '+ New goal' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ship v2')
    await user.click(screen.getByTestId('goal-submit'))
    expect(bridge.saveGoal).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'Ship v2' })
    expect(screen.getByTestId('goal-select-g-new')).toHaveAttribute('aria-current', 'page')
    expect(dialogToast('goals')).toMatchObject({ kind: 'success', title: 'Goal saved.' })
  })

  it("the rail lists this workspace's goals with done/total", () => {
    open({
      goals: [goal(), goal({ id: 'g2', name: 'Elsewhere', workspaceId: 'default' })],
      tasks: [
        task(),
        task({ id: 't2', status: 'done' }),
        task({ id: 't3', goalId: 'g2', workspaceId: 'default' })
      ],
      proposals: []
    })
    const row = screen.getByTestId('goal-row-g1')
    expect(row).toHaveTextContent('Ship v2')
    expect(within(row).getByTestId('goal-progress-text')).toHaveTextContent('1/2')
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument()
    expect(within(row).getByRole('progressbar')).toHaveAccessibleName('Progress of Ship v2')
  })

  it('the Daily tasks row lists tasks without a goal', async () => {
    const user = userEvent.setup()
    open({
      goals: [goal()],
      tasks: [task(), task({ id: 't9', goalId: null, title: 'Water the plants' })],
      proposals: []
    })
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('button', { name: /Daily tasks/ }))
    expect(screen.getByRole('button', { name: 'Done Water the plants' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done Write the spec' })).not.toBeInTheDocument()
  })

  it("a task's Done calls setTaskStatus done; its Undo reopens it", async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('button', { name: 'Done Write the spec' }))
    expect(bridge.setTaskStatus).toHaveBeenLastCalledWith('t1', 'done')
    expect(screen.getByRole('button', { name: 'Undo Write the spec' })).toHaveTextContent('Undo')
    await user.click(screen.getByRole('button', { name: 'Undo Write the spec' }))
    expect(bridge.setTaskStatus).toHaveBeenLastCalledWith('t1', 'open')
  })

  it('+ New task adds a task to the selected goal', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.type(screen.getByRole('textbox', { name: '+ New task' }), 'Cut the release{Enter}')
    expect(bridge.saveTask).toHaveBeenCalledWith({
      workspaceId: 'w1',
      goalId: 'g1',
      title: 'Cut the release'
    })
    expect(bridge.saveGoal).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Done Cut the release' })).toBeInTheDocument()
  })

  it('a task a session closed says so', async () => {
    const user = userEvent.setup()
    open({
      goals: [goal()],
      tasks: [task({ status: 'done', doneBy: 'session', doneAt: 5 })],
      proposals: []
    })
    await user.click(screen.getByTestId('goal-select-g1'))
    expect(screen.getByTestId('task-done-by-t1')).toHaveTextContent('Closed by a session')
  })

  it('Delete arms in place and removes the goal', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByTestId('goal-delete-g1'))
    expect(bridge.deleteGoal).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('goal-delete-confirm'))
    expect(bridge.deleteGoal).toHaveBeenCalledWith('g1')
    expect(screen.getByTestId('goal-select-daily')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByTestId('goal-row-g1')).not.toBeInTheDocument()
  })

  it('Default folder shows None, Choose… calls pickGoalFolder, Clear clears it', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    expect(screen.getByTestId('goal-default-cwd')).toHaveTextContent('None')
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose…' }))
    expect(bridge.pickFolder).toHaveBeenCalledWith('g1')
    expect(screen.getByTestId('goal-default-cwd')).toHaveTextContent('/home/j/app')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(bridge.clearFolder).toHaveBeenCalledWith('g1')
    expect(screen.getByTestId('goal-default-cwd')).toHaveTextContent('None')
  })

  it('Start session sends the selected task ids and markDone true', async () => {
    const user = userEvent.setup()
    open({
      goals: [goal()],
      tasks: [
        task(),
        task({ id: 't2', title: 'Cut the release' }),
        task({ id: 't3', title: 'Tell the team' }),
        task({ id: 't4', title: 'Old', status: 'done' })
      ],
      proposals: []
    })
    await user.click(screen.getByTestId('goal-select-g1'))
    // Nothing selected: no bar. A done task cannot be selected.
    expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Old' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select Write the spec' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Tell the team' }))
    expect(screen.getByTestId('task-start-count')).toHaveTextContent('2 selected')
    // Selecting is not marking done.
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Claude can mark tasks done' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    expect(bridge.start).toHaveBeenCalledWith({
      workspaceId: 'w1',
      goalId: 'g1',
      groups: [{ taskIds: ['t1', 't3'] }],
      markDone: true
    })
    expect(bridge.setTaskStatus).not.toHaveBeenCalled()
    expect(dialogToast('goals')).toMatchObject({ kind: 'success', title: 'Session started.' })
    // The selection is spent: the bar goes away.
    expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument()
  })

  it('the switch turned off sends markDone false; loose tasks send no goal', async () => {
    const user = userEvent.setup()
    open({ goals: [], tasks: [task({ id: 't9', goalId: null, title: 'Water' })], proposals: [] })
    await user.click(screen.getByRole('button', { name: /Daily tasks/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Water' }))
    await user.click(screen.getByRole('switch', { name: 'Claude can mark tasks done' }))
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    expect(bridge.start).toHaveBeenCalledWith({
      workspaceId: 'w1',
      goalId: null,
      groups: [{ taskIds: ['t9'] }],
      markDone: false
    })
  })

  it.each([
    ['task_not_found', 'Could not start sessions.'],
    ['goal_workspace_mismatch', 'Could not start sessions.'],
    ['folder_missing', 'That folder no longer exists.'],
    ['claude_version', 'or newer to launch from the app.']
  ])('a %s refusal says so in an error toast and keeps the selection', async (code, copy) => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [] })
    bridge.start = vi.fn(() =>
      Promise.reject(
        new Error(`Error invoking remote method 'goals:start-sessions': Error: ${code}`)
      )
    )
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('checkbox', { name: 'Select Write the spec' }))
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    expect(dialogToast('goals')).toMatchObject({
      kind: 'error',
      title: expect.stringContaining(copy)
    })
    expect(screen.getByRole('checkbox', { name: 'Select Write the spec' })).toBeChecked()
  })

  it('a cancelled folder pick says nothing and keeps the selection', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [] })
    bridge.start = vi.fn(() =>
      Promise.reject(
        new Error(`Error invoking remote method 'goals:start-sessions': Error: launch_cancelled`)
      )
    )
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('checkbox', { name: 'Select Write the spec' }))
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    expect(bridge.start).toHaveBeenCalled()
    expect(dialogToast('goals')).toBeUndefined()
    expect(screen.getByRole('checkbox', { name: 'Select Write the spec' })).toBeChecked()
  })
})
