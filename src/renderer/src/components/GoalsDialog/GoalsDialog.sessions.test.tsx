// Goals — a goal form's memory parts (spec 2026-11-18 memory session goals, "Renderer"; CUJs 9
// and 11): the `Made by memory.` hint, the `Worked on by` section (its rows, `Open`, the cap, the
// Past sessions load) and the Delete count. The real goalsStore, pastSessionsStore and boardStore
// run; only the IPC bridges are faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalsDialog } from './GoalsDialog'
import { goalsStore } from '../../stores/goalsStore'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { boardStore, type BoardSession } from '../../stores/boardStore'
import type { Goal, PastSession, Task, Workspace } from '../../../../shared/ipc/contract'
import { dialogToast } from '../../test/toasts'
import { cssRule } from '../../test/cssRule'

const WS: Workspace[] = [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }]

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  workspaceId: 'w1',
  name: 'Fix login',
  defaultCwd: '/repo',
  saveToFile: false,
  createdAt: 1,
  memorySessionIds: [],
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
  check: null,
  leftWith: null,
  lastSeenAt: null,
  report: null,
  originSessionId: null,
  folder: null,
  touchedBy: [],
  ...over
})
const record = (id: string, name: string): PastSession => ({
  id,
  name,
  cwd: '/repo',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
})
const live = (id: string, sessionName: string): BoardSession => ({
  id,
  sessionName,
  projectPath: '/repo',
  status: 'x',
  pid: 1,
  column: 'working',
  enteredColumnAt: 1,
  workspaceId: 'w1',
  tagIds: []
})
const exactly = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
const wrapped = (code: string): Error =>
  new Error(`Error invoking remote method 'past-sessions:open': Error: ${code}`)

let list: ReturnType<typeof vi.fn>
let openPast: ReturnType<typeof vi.fn>
let unmount: (() => void) | undefined

beforeEach(() => {
  list = vi.fn(() => Promise.resolve([] as PastSession[]))
  openPast = vi.fn(() => Promise.resolve({ terminalId: 'term-9', workspaceId: 'w1', name: 'x' }))
  ;(window as unknown as { pastSessions: unknown }).pastSessions = { list, open: openPast }
  ;(window as unknown as { workspaces: unknown }).workspaces = {
    setActive: vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: WS }))
  }
  ;(window as unknown as { goals: unknown }).goals = { onChanged: vi.fn(() => () => {}) }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    pastSessionsStore.setState({ sessions: [], loaded: false })
    boardStore.setState({ viewMode: 'board', focusedTerminalId: null, launchedTerminals: {} })
    boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {}, selectedId: null })
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    goalsStore.setState({
      goals: [],
      tasks: [],
      fileProblems: [],
      loaded: false,
      loadFailed: false
    })
    pastSessionsStore.setState({ sessions: [], loaded: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {}, selectedId: null })
  })
  vi.restoreAllMocks()
})

/** Open the sheet on goal `g1` (selected through its rail row). */
async function openGoal(
  goals: Goal[],
  tasks: Task[],
  onClose: () => void = () => {}
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  act(() =>
    goalsStore.setState({ goals, tasks, fileProblems: [], loaded: true, loadFailed: false })
  )
  unmount = render(<GoalsDialog onClose={onClose} />).unmount
  await user.click(screen.getByTestId('goal-select-g1'))
  return user
}

const touched = (id: string, title: string, sessionId: string, at = 1): Task =>
  task({ id, title, touchedBy: [{ sessionId, at }] })

describe('GoalsDialog goal form: Made by memory', () => {
  it('a memory goal says so under its name; an operator goal does not', async () => {
    await openGoal([goal({ memorySessionIds: ['s1'] })], [])
    expect(screen.getByTestId('goal-memory-hint')).toHaveTextContent('Made by memory.')
    unmount?.()
    unmount = undefined
    await openGoal([goal()], [])
    expect(screen.queryByTestId('goal-memory-hint')).not.toBeInTheDocument()
  })
})

describe('GoalsDialog goal form: Worked on by', () => {
  it('shows only when a task has a touch, also on a goal with no folder', async () => {
    await openGoal([goal()], [task()])
    expect(screen.queryByTestId('goal-sessions')).not.toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
    unmount?.()
    unmount = undefined
    act(() => pastSessionsStore.setState({ sessions: [record('s1', 'Spike')], loaded: true }))
    await openGoal([goal({ defaultCwd: null })], [touched('t1', 'Write the spec', 's1')])
    const section = screen.getByTestId('goal-sessions')
    expect(within(section).getByText('Worked on by')).toBeInTheDocument()
    expect(within(section).getByText('Write the spec')).toBeInTheDocument()
  })

  it('a live row is the session button; a click closes the sheet and opens its card', async () => {
    act(() => boardStore.setState({ sessionsById: { s1: live('s1', 'Spike') } }))
    const closedWith: (string | null)[] = []
    const user = await openGoal([goal()], [touched('t1', 'Write the spec', 's1')], () =>
      closedWith.push(boardStore.getState().selectedId)
    )
    const button = screen.getByTestId('goal-session-live-s1')
    expect(button).toHaveTextContent('Spike')
    await user.click(button)
    expect(closedWith).toEqual([null])
    expect(boardStore.getState().selectedId).toBe('s1')
  })

  it('a past row opens the session and closes the sheet', async () => {
    list.mockResolvedValue([record('s1', 'Fix login')])
    const onClose = vi.fn()
    const user = await openGoal([goal()], [touched('t1', 'Write the spec', 's1')], onClose)
    const row = await screen.findByTestId('goal-session-s1')
    expect(row).toHaveTextContent('Fix login')
    await user.click(within(row).getByTestId('goal-session-open-s1'))
    expect(openPast).toHaveBeenCalledWith('s1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('already_open goes to the live card and closes the sheet', async () => {
    list.mockResolvedValue([record('s1', 'Fix login')])
    // The card reached the board after the row was drawn: main refuses, the renderer knows it.
    openPast.mockImplementation(() => {
      act(() =>
        boardStore.setState({
          sessionsById: { s1: live('s1', 'Fix login') },
          terminalIdBySessionId: { s1: 'term-1' }
        })
      )
      return Promise.reject(wrapped('already_open'))
    })
    const onClose = vi.fn()
    const user = await openGoal([goal()], [touched('t1', 'Write the spec', 's1')], onClose)
    await user.click(await screen.findByTestId('goal-session-open-s1'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(boardStore.getState().focusedTerminalId).toBe('term-1')
    expect(dialogToast('goals')).toBeUndefined()
  })

  it('any other refusal is the result toast, in the Past sessions wording', async () => {
    list.mockResolvedValue([record('s1', 'Fix login')])
    openPast.mockRejectedValue(wrapped('folder_missing'))
    const onClose = vi.fn()
    const user = await openGoal([goal()], [touched('t1', 'Write the spec', 's1')], onClose)
    await user.click(await screen.findByTestId('goal-session-open-s1'))
    expect(dialogToast('goals')).toMatchObject({
      kind: 'error',
      title: 'That folder no longer exists'
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a session in neither place reads No longer listed, with no button', async () => {
    await openGoal([goal()], [touched('t1', 'Write the spec', 'gone')])
    const row = await screen.findByTestId('goal-session-gone')
    await vi.waitFor(() => expect(row).toHaveTextContent('No longer listed'))
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws at most 20 rows, then <n> more', async () => {
    const tasks = Array.from({ length: 22 }, (_, i) => touched(`t${i}`, `Task ${i}`, `s${i}`, i))
    await openGoal([goal()], tasks)
    const section = screen.getByTestId('goal-sessions')
    expect(within(section).getAllByRole('listitem')).toHaveLength(20)
    expect(screen.getByTestId('goal-sessions-more')).toHaveTextContent('2 more')
    // Newest touch first: s21 leads, s0 and s1 are the two cut.
    expect(screen.getByTestId('goal-session-s21')).toBeInTheDocument()
    expect(screen.queryByTestId('goal-session-s1')).not.toBeInTheDocument()
  })

  it('a first touch arriving while the form is open loads Past sessions once', async () => {
    await openGoal([goal()], [task()])
    expect(list).not.toHaveBeenCalled()
    act(() => goalsStore.setState({ tasks: [touched('t1', 'Write the spec', 's1', 1)] }))
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    act(() => goalsStore.setState({ tasks: [touched('t1', 'Write the spec', 's2', 2)] }))
    expect(await screen.findByTestId('goal-session-s2')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('a failed load shows the Callout and keeps the rows of the older copy', async () => {
    list.mockRejectedValue(new Error('read_failed'))
    act(() => pastSessionsStore.setState({ sessions: [record('s1', 'Fix login')], loaded: true }))
    await openGoal([goal()], [touched('t1', 'Write the spec', 's1')])
    expect(await screen.findByTestId('goal-sessions-load-failed')).toHaveTextContent(
      'Could not load past sessions'
    )
    expect(screen.getByTestId('goal-session-s1')).toHaveTextContent('Fix login')
    expect(screen.getByTestId('goal-session-open-s1')).toBeInTheDocument()
  })

  it('a failed first load shows unknown rows: the titles only', async () => {
    list.mockRejectedValue(new Error('read_failed'))
    await openGoal([goal()], [touched('t1', 'Write the spec', 's1')])
    await screen.findByTestId('goal-sessions-load-failed')
    const row = screen.getByTestId('goal-session-s1')
    expect(row).toHaveTextContent('Write the spec')
    expect(row).not.toHaveTextContent('No longer listed')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('the section sets no margin of its own (the nested Label spaces it)', () => {
    const rule = cssRule('components/GoalsDialog/GoalsDialog.module.css', '.workedOnField')
    expect(rule).not.toMatch(/margin/)
  })
})

describe('GoalsDialog goal form: Delete says what goes', () => {
  it.each([
    [0, 'Confirm delete'],
    [1, 'Confirm delete (1 task)'],
    [3, 'Confirm delete (3 tasks)']
  ])('%i tasks: %s', async (n, label) => {
    const tasks = Array.from({ length: n }, (_, i) => task({ id: `t${i}` }))
    const user = await openGoal([goal()], tasks)
    await user.click(screen.getByTestId('goal-delete-g1'))
    // Exact: `Confirm delete` alone must not be a prefix of a longer label.
    expect(screen.getByTestId('goal-delete-confirm')).toHaveTextContent(exactly(label))
  })
})
