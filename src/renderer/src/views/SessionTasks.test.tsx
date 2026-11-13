// The focused view's task panel (spec 2026-10-19 Decision E). The real goalsStore and the real
// panel run; only the IPC bridge is faked, by a small stand-in for main that keeps the view.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionTasks } from './SessionTasks'
import { tasksDividerHandlers } from './tasksPanelWidth'
import { goalsStore } from '../stores/goalsStore'
import { boardStore } from '../stores/boardStore'
import type { Goal, GoalsView, Task, TaskStatus } from '../../../shared/ipc/contract'

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  workspaceId: 'w1',
  name: 'Ship v2',
  defaultCwd: null,
  saveToFile: false,
  createdAt: 1,
  ...over
})
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  workspaceId: 'w1',
  goalId: 'g1',
  title: 'Write the spec',
  status: 'open',
  sessionIds: ['s1'],
  createdAt: 1,
  doneAt: null,
  doneBy: null,
  check: null,
  leftWith: null,
  lastSeenAt: null,
  report: null,
  originSessionId: null,
  folder: null,
  ...over
})

let view: GoalsView
let bridge: Record<string, ReturnType<typeof vi.fn>>

function install(initial: GoalsView): void {
  view = initial
  const answer = (): Promise<GoalsView> => Promise.resolve(view)
  const edit = (id: string, f: (t: Task) => Task): Promise<GoalsView> => {
    view = { ...view, tasks: view.tasks.map((t) => (t.id === id ? f(t) : t)) }
    return answer()
  }
  bridge = {
    setTaskStatus: vi.fn((id: string, status: TaskStatus) => edit(id, (t) => ({ ...t, status }))),
    linkTask: vi.fn((id: string, sid: string) =>
      edit(id, (t) => ({ ...t, sessionIds: [...t.sessionIds, sid] }))
    ),
    unlinkTask: vi.fn((id: string, sid: string) =>
      edit(id, (t) => ({ ...t, sessionIds: t.sessionIds.filter((x) => x !== sid) }))
    ),
    onChanged: vi.fn(() => () => {})
  }
  ;(window as unknown as { goals: unknown }).goals = bridge
  act(() =>
    goalsStore.setState({ goals: view.goals, tasks: view.tasks, loaded: true, loadFailed: false })
  )
}

let unmount: (() => void) | undefined
function open(initial: GoalsView): void {
  install(initial)
  unmount = render(<SessionTasks sessionId="s1" workspaceId="w1" width={260} />).unmount
}

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => goalsStore.setState({ goals: [], tasks: [], loaded: false, loadFailed: false }))
  vi.restoreAllMocks()
})

describe('SessionTasks', () => {
  it('its head reads Tasks on the left, Link task on the right, above the list', () => {
    open({ goals: [goal()], tasks: [], proposals: [], fileProblems: [] })
    const head = screen.getByTestId('session-tasks-head')
    const title = within(head).getByText('Tasks')
    const link = within(head).getByRole('button', { name: 'Link task' })
    const after = (a: Node, b: Node): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(after(title, link)).toBe(true)
    // The head comes before the empty line.
    expect(after(head, screen.getByText('No tasks linked to this session.'))).toBe(true)
    expect(screen.getByTestId('session-tasks')).toContainElement(head)
  })

  it("lists this session's tasks and marks one done", async () => {
    const user = userEvent.setup()
    open({
      goals: [goal()],
      tasks: [task(), task({ id: 't2', title: 'Other session', sessionIds: ['s2'] })],
      proposals: [],
      fileProblems: []
    })
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done Other session' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done Write the spec' }))
    expect(bridge.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(screen.getByRole('button', { name: 'Undo Write the spec' })).toBeInTheDocument()
  })

  it("counts only this session's tasks of the goal, not the goal's other tasks", () => {
    open({
      goals: [goal()],
      tasks: [
        task(),
        task({ id: 't2', status: 'done' }),
        task({ id: 't3', status: 'done', sessionIds: [] }),
        task({ id: 't4', sessionIds: ['s2'] })
      ],
      proposals: [],
      fileProblems: []
    })
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAccessibleName('Progress of Ship v2')
    expect(screen.getByTestId('goal-progress-text')).toHaveTextContent('1/2')
  })

  it('Link task lists only open tasks of the workspace not linked here', async () => {
    const user = userEvent.setup()
    open({
      goals: [goal()],
      tasks: [
        task(),
        task({ id: 't2', title: 'Free one', sessionIds: [] }),
        task({ id: 't3', title: 'Already done', sessionIds: [], status: 'done' }),
        task({ id: 't4', title: 'Elsewhere', sessionIds: [], workspaceId: 'w2' }),
        task({ id: 't5', title: 'Linked to other', sessionIds: ['s2'] })
      ],
      proposals: [],
      fileProblems: []
    })
    await user.click(screen.getByRole('button', { name: 'Link task' }))
    const menu = screen.getByRole('menu')
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    expect(names).toEqual(['Free one', 'Linked to other'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Free one' }))
    expect(bridge.linkTask).toHaveBeenCalledWith('t2', 's1')
    expect(screen.getByRole('button', { name: 'Done Free one' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Link task says so when there is nothing to link', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [], fileProblems: [] })
    await user.click(screen.getByRole('button', { name: 'Link task' }))
    expect(screen.getByRole('menu')).toHaveTextContent('No open tasks to link.')
  })

  it('unlink removes the row', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [], fileProblems: [] })
    await user.click(screen.getByRole('button', { name: 'Unlink Write the spec' }))
    expect(bridge.unlinkTask).toHaveBeenCalledWith('t1', 's1')
    expect(screen.queryByRole('button', { name: 'Done Write the spec' })).not.toBeInTheDocument()
  })

  it('a refused Done says so and leaves the task as main has it', async () => {
    const user = userEvent.setup()
    open({ goals: [goal()], tasks: [task()], proposals: [], fileProblems: [] })
    bridge.setTaskStatus!.mockRejectedValueOnce(new Error('boom'))
    await user.click(screen.getByRole('button', { name: 'Done Write the spec' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save task.')
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeInTheDocument()
  })

  it('a loose task is grouped under Daily tasks, with its own progress', () => {
    open({ goals: [], tasks: [task({ goalId: null })], proposals: [], fileProblems: [] })
    expect(screen.getByText('Daily tasks')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Progress of Daily tasks')
  })

  it("Daily tasks counts only this session's daily tasks, not the workspace's", () => {
    open({
      goals: [],
      tasks: [
        task({ goalId: null }),
        task({ id: 't2', goalId: null, status: 'done', sessionIds: [] }),
        task({ id: 't3', goalId: null, sessionIds: ['s2'] }),
        task({ id: 't4', goalId: null, sessionIds: [] })
      ],
      proposals: [],
      fileProblems: []
    })
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Progress of Daily tasks')
    expect(screen.getByTestId('goal-progress-text')).toHaveTextContent('0/1')
  })

  it('shows no session line: the session is the one you are in', () => {
    act(() =>
      boardStore.setState({
        sessionsById: {
          s1: {
            id: 's1',
            sessionName: 'build-api',
            projectPath: '/p',
            status: 'x',
            pid: 1,
            column: 'working',
            enteredColumnAt: 1,
            workspaceId: 'w1',
            tagIds: []
          }
        }
      })
    )
    open({ goals: [goal()], tasks: [task()], proposals: [], fileProblems: [] })
    expect(screen.getByText('Write the spec')).toBeInTheDocument()
    expect(screen.queryByTestId('task-sessions-t1')).not.toBeInTheDocument()
    act(() => boardStore.setState({ sessionsById: {} }))
  })

  it('opened with nothing linked it says so', () => {
    open({ goals: [goal()], tasks: [], proposals: [], fileProblems: [] })
    expect(screen.getByTestId('session-tasks')).toHaveTextContent(
      'No tasks linked to this session.'
    )
  })

  it('a Done, a link and an unlink disable their control while main answers', async () => {
    const user = userEvent.setup()
    open({
      goals: [goal()],
      tasks: [task(), task({ id: 't2', title: 'Free one', sessionIds: [] })],
      proposals: [],
      fileProblems: []
    })
    let release: (v: GoalsView) => void = () => {}
    const pending = (): Promise<GoalsView> => new Promise((r) => (release = r))
    bridge.setTaskStatus!.mockImplementationOnce(pending)
    await user.click(screen.getByRole('button', { name: 'Done Write the spec' }))
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeDisabled()
    await act(async () => release(view))
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeEnabled()

    bridge.unlinkTask!.mockImplementationOnce(pending)
    await user.click(screen.getByRole('button', { name: 'Unlink Write the spec' }))
    expect(screen.getByRole('button', { name: 'Unlink Write the spec' })).toBeDisabled()
    await act(async () => release(view))

    bridge.linkTask!.mockImplementationOnce(pending)
    await user.click(screen.getByRole('button', { name: 'Link task' }))
    await user.click(screen.getByRole('menuitem', { name: 'Free one' }))
    expect(screen.getByRole('button', { name: 'Link task' })).toBeDisabled()
    await act(async () => release(view))
    expect(bridge.linkTask).toHaveBeenCalledTimes(1)
  })
})

describe('tasksDividerHandlers', () => {
  it('a drag left widens the panel, held between 200 and 640px', () => {
    const map = tasksDividerHandlers(260).startDrag(700)
    expect(map?.(600)).toBe(360)
    expect(map?.(900)).toBe(200)
    expect(map?.(0)).toBe(640)
  })
  it('keys step 20px (left = wider), and the reset is 260px', () => {
    const h = tasksDividerHandlers(300)
    expect(h.stepValue(-1)).toBe(320)
    expect(h.stepValue(1)).toBe(280)
    expect(h.resetValue).toBe(260)
    expect([h.valueNow, h.valueMin, h.valueMax]).toEqual([300, 200, 640])
  })
})
