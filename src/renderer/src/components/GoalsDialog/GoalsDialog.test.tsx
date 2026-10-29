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
import { boardStore, type BoardSession } from '../../stores/boardStore'
import type {
  Goal,
  GoalSaveRequest,
  GoalsView,
  Task,
  TaskSaveRequest,
  TaskStatus
} from '../../../../shared/ipc/contract'
import { dialogToast } from '../../test/toasts'
import { cssRule } from '../../test/cssRule'

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
      const existing = view.tasks.find((t) => t.id === req.id)
      const saved = existing
        ? { ...existing, title: req.title }
        : task({ id: 't-new', goalId: req.goalId, title: req.title })
      view = { ...view, tasks: [...view.tasks.filter((t) => t !== existing), saved] }
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
    boardStore.setState({ sessionsById: {}, selectedId: null })
  })
  vi.restoreAllMocks()
})

function open(
  initial: GoalsView = { goals: [], tasks: [], proposals: [] },
  onClose: () => void = () => {}
): void {
  installBridge(initial)
  unmount = render(<GoalsDialog onClose={onClose} />).unmount
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

// Read more + edit (spec 2026-10-29 task read more + edit): ▸ opens a row to its full title and
// an `Edit` button; Edit turns the title into a field with `Save` / `Cancel`.
describe('GoalsDialog task row: open and edit', () => {
  const LONG =
    'Refactor the goals store so a goal with the shared file keeps its tasks in that file'

  async function openRow(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    open({ goals: [goal()], tasks: [task({ title: LONG })], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('button', { name: `Show full text ${LONG}` }))
  }

  it('▸ opens the row: the toggle is expanded and Edit shows; ▾ closes it again', async () => {
    const user = userEvent.setup()
    await openRow(user)
    const toggle = screen.getByRole('button', { name: `Hide full text ${LONG}` })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: `Edit ${LONG}` })).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByRole('button', { name: `Show full text ${LONG}` })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByRole('button', { name: `Edit ${LONG}` })).not.toBeInTheDocument()
  })

  it('Edit → Save sends the task id with the new title; the open row shows it', async () => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    const field = screen.getByRole('textbox', { name: 'Task title' })
    expect(field).toHaveValue(LONG)
    expect(field).toHaveFocus()
    await user.clear(field)
    await user.type(field, 'Ship the shared file')
    // The goal form has its own `Save`; the row's is the one by the field.
    await user.click(screen.getByTestId('task-edit-save-t1'))
    expect(bridge.saveTask).toHaveBeenCalledWith({
      id: 't1',
      workspaceId: 'w1',
      goalId: 'g1',
      title: 'Ship the shared file'
    })
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hide full text Ship the shared file' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('the edit field is a 3-row text area, so a long title wraps while it is edited', async () => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    const field = screen.getByRole('textbox', { name: 'Task title' })
    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveAttribute('rows', '3')
  })

  it('Shift+Enter saves too: a title stays one line', async () => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), '!{Shift>}{Enter}{/Shift}')
    expect(bridge.saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: `${LONG}!` }))
  })

  it('a pasted line break becomes a space', async () => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    const field = screen.getByRole('textbox', { name: 'Task title' })
    await user.clear(field)
    await user.paste('first line\n  second line')
    expect(field).toHaveValue('first line second line')
  })

  it('Enter in the field saves', async () => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), '!{Enter}')
    expect(bridge.saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: `${LONG}!` }))
    expect(bridge.saveGoal).not.toHaveBeenCalled()
  })

  it('Escape cancels the edit only: nothing is saved and the dialog stays open', async () => {
    const user = userEvent.setup()
    installBridge({ goals: [goal()], tasks: [task({ title: LONG })], proposals: [] })
    const onClose = vi.fn()
    unmount = render(<GoalsDialog onClose={onClose} />).unmount
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('button', { name: `Show full text ${LONG}` }))
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), ' more{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(bridge.saveTask).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: `Hide full text ${LONG}` })).toBeInTheDocument()
  })

  it('Cancel leaves edit mode without saving', async () => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), ' more')
    await user.click(screen.getByTestId('task-edit-cancel-t1'))
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    expect(bridge.saveTask).not.toHaveBeenCalled()
  })

  it.each([
    ['an unchanged', ''],
    ['an empty', '{Control>}a{/Control}{Backspace}  ']
  ])('Save with %s title leaves edit mode without a call', async (_label, keys) => {
    const user = userEvent.setup()
    await openRow(user)
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), `${keys}{Enter}`)
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    expect(bridge.saveTask).not.toHaveBeenCalled()
  })

  it('a refused save says so in the error toast and keeps the typed title', async () => {
    const user = userEvent.setup()
    await openRow(user)
    bridge.saveTask = vi.fn(() =>
      Promise.reject(new Error(`Error invoking remote method 'goals:save-task': Error: x`))
    )
    await user.click(screen.getByRole('button', { name: `Edit ${LONG}` }))
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), '!{Enter}')
    expect(dialogToast('goals')).toMatchObject({ kind: 'error', title: 'Could not save task.' })
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue(`${LONG}!`)
  })

  it('a done task opens and edits too', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task({ status: 'done' })], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    await user.click(screen.getByRole('button', { name: 'Show full text Write the spec' }))
    expect(screen.getByRole('button', { name: 'Edit Write the spec' })).toBeInTheDocument()
  })
})

// Spec 2026-10-29 goals page polish: the tasks section (progress bar, rows, `+ New task`, start
// bar) sits in one darker box; `Plan with Claude` is a different region, outside it.
describe('GoalsDialog — the tasks box', () => {
  it('a goal draws its progress bar inside the tasks box and Plan with Claude outside it', async () => {
    const user = userEvent.setup()
    open({ goals: [goal({ defaultCwd: '/repo' })], tasks: [task()], proposals: [] })
    await user.click(screen.getByTestId('goal-select-g1'))
    const box = screen.getByTestId('task-list')
    expect(within(box).getByRole('progressbar', { name: 'Progress of Ship v2' })).toBeVisible()
    expect(within(box).queryByTestId('goal-plan')).not.toBeInTheDocument()
    expect(screen.getByTestId('goal-plan')).toBeInTheDocument()
  })

  it('Daily tasks draw their progress bar inside the tasks box too', () => {
    open({ goals: [], tasks: [task({ goalId: null })], proposals: [] })
    const box = screen.getByTestId('task-list')
    expect(within(box).getByRole('progressbar', { name: 'Progress of Daily tasks' })).toBeVisible()
  })

  it('the box is a darker well with the card inset; Plan with Claude a section below', () => {
    const sheet = 'components/GoalsDialog/GoalsDialog.module.css'
    const tasks = cssRule(sheet, '.tasks')
    expect(tasks).toMatch(/background:\s*var\(--bg-inset\)/)
    expect(tasks).toMatch(/border:\s*1px solid var\(--border\)/)
    expect(tasks).toMatch(/border-radius:\s*var\(--rounded-md\)/)
    expect(tasks).toMatch(/padding:\s*var\(--inset-card\)/)
    expect(cssRule(sheet, '.planRow')).toMatch(
      /margin-top:\s*calc\(var\(--gap-section\) - var\(--gap-field\)\)/
    )
  })
})

const live = (
  id: string,
  column: BoardSession['column'],
  over: Partial<BoardSession> = {}
): BoardSession => ({
  id,
  sessionName: id,
  projectPath: `/p/${id}`,
  status: 'x',
  pid: 1,
  column,
  enteredColumnAt: 1,
  workspaceId: 'w1',
  tagIds: [],
  ...over
})

describe('GoalsDialog task row: who works on it', () => {
  function openLinked(onClose?: () => void): void {
    act(() =>
      boardStore.setState({
        sessionsById: { s1: live('s1', 'working', { sessionName: 'build-api' }) }
      })
    )
    open({ goals: [], tasks: [task({ goalId: null, sessionIds: ['s1'] })], proposals: [] }, onClose)
  }

  it('shows the status word and name of each live linked session', () => {
    openLinked()
    const entry = screen.getByTestId('task-session-open-s1')
    expect(within(entry).getByTestId('status-label')).toHaveTextContent('Working')
    expect(entry).toHaveTextContent('build-api')
    expect(entry).toHaveAttribute('title', 'Open build-api')
  })

  it('follows a status change while the sheet is open', () => {
    openLinked()
    act(() => boardStore.setState({ sessionsById: { s1: live('s1', 'needs-you') } }))
    const entry = screen.getByTestId('task-session-open-s1')
    expect(within(entry).getByTestId('status-label')).toHaveTextContent('Needs you')
  })

  it('drops a session that ended', () => {
    openLinked()
    act(() => boardStore.setState({ sessionsById: {} }))
    expect(screen.queryByTestId('task-sessions-t1')).not.toBeInTheDocument()
  })

  it('a click closes the sheet first, then opens the session', async () => {
    const user = userEvent.setup()
    const selectedAtClose: (string | null)[] = []
    openLinked(() => selectedAtClose.push(boardStore.getState().selectedId))
    await user.click(screen.getByTestId('task-session-open-s1'))
    expect(selectedAtClose).toEqual([null])
    expect(boardStore.getState().selectedId).toBe('s1')
  })
})

describe('GoalsDialog task row: Link session', () => {
  function openWith(
    sessions: Record<string, BoardSession>,
    tasks: Task[] = [task({ goalId: null })],
    onClose?: () => void
  ): void {
    act(() => boardStore.setState({ sessionsById: sessions }))
    open({ goals: [], tasks, proposals: [] }, onClose)
  }

  it('an open task offers Link session; a done task does not', () => {
    openWith({}, [task({ goalId: null }), task({ id: 't2', goalId: null, status: 'done' })])
    expect(screen.getByTestId('task-link-t1')).toHaveTextContent('Link session')
    expect(screen.queryByTestId('task-link-t2')).not.toBeInTheDocument()
  })

  it("lists the workspace's live sessions not linked yet, Needs you first", async () => {
    const user = userEvent.setup()
    openWith(
      {
        idle: live('idle', 'idle', { enteredColumnAt: 1 }),
        need: live('need', 'needs-you', { enteredColumnAt: 5 }),
        linked: live('linked', 'working'),
        other: live('other', 'working', { workspaceId: 'w2' })
      },
      [task({ goalId: null, sessionIds: ['linked'] })]
    )
    await user.click(screen.getByTestId('task-link-t1'))
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual([
      'task-link-pick-need',
      'task-link-pick-idle'
    ])
  })

  it('says so when no live session can be linked', async () => {
    const user = userEvent.setup()
    openWith({})
    await user.click(screen.getByTestId('task-link-t1'))
    expect(screen.getByTestId('task-link-none-t1')).toHaveTextContent('No live sessions to link.')
  })

  it('picking a session links the task, closes the menu and the row shows it', async () => {
    const user = userEvent.setup()
    openWith({ s1: live('s1', 'working', { sessionName: 'build-api' }) })
    bridge.linkTask = vi.fn((taskId: string, sessionId: string) => {
      view = {
        ...view,
        tasks: view.tasks.map((t) => (t.id === taskId ? { ...t, sessionIds: [sessionId] } : t))
      }
      return Promise.resolve(view)
    })
    await user.click(screen.getByTestId('task-link-t1'))
    await user.click(screen.getByTestId('task-link-pick-s1'))
    expect(bridge.linkTask).toHaveBeenCalledWith('t1', 's1')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-session-open-s1')).toHaveTextContent('build-api')
  })

  it('a refused link says so in the error toast', async () => {
    const user = userEvent.setup()
    openWith({ s1: live('s1', 'working') })
    bridge.linkTask = vi.fn(() =>
      Promise.reject(
        new Error(`Error invoking remote method 'goals:link-task': Error: session_not_found`)
      )
    )
    await user.click(screen.getByTestId('task-link-t1'))
    await user.click(screen.getByTestId('task-link-pick-s1'))
    expect(dialogToast('goals')).toMatchObject({ kind: 'error', title: 'Could not link task.' })
  })

  it('Escape closes the menu only: the sheet stays open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    openWith({ s1: live('s1', 'working') }, undefined, onClose)
    await user.click(screen.getByTestId('task-link-t1'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape from inside the menu puts focus back on Link session', async () => {
    const user = userEvent.setup()
    openWith({ s1: live('s1', 'working') })
    await user.click(screen.getByTestId('task-link-t1'))
    act(() => screen.getByTestId('task-link-pick-s1').focus())
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('task-link-t1')).toHaveFocus()
  })

  it('a press outside closes the menu', async () => {
    const user = userEvent.setup()
    openWith({ s1: live('s1', 'working') })
    await user.click(screen.getByTestId('task-link-t1'))
    await user.click(screen.getByTestId('goal-daily-pane'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('a long menu scrolls inside its list', () => {
    expect(cssRule('components/GoalsDialog/GoalsDialog.module.css', '.linkMenuWrap')).toMatch(
      /--popover-max-height:\s*\d+px/
    )
  })
})
