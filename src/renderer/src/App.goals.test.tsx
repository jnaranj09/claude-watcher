// The header's Goals button — App-level wiring (spec 2026-10-19-goals): it sits between
// `+ New session` and the ☰ menu, opens the Goals sheet under the single-modal rule, and Escape from
// the page body closes it. Fake window bridges from the shared App harness, no Electron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { unmountRendered } from './test/renderComponent'
import { goalsStore, loadGoals } from './stores/goalsStore'
import { workspacesStore } from './stores/workspacesStore'
import { renderApp, resetBoardView, stubAppBridges } from './test/appHarness'

beforeEach(() => {
  resetBoardView()
  stubAppBridges({ launch: { pickDirectory: vi.fn(() => Promise.resolve('/home/op/project')) } })
})
afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
})

describe('App — the Goals button', () => {
  it('the header shows the Goals icon button left of + New session', async () => {
    await renderApp()
    const header = screen.getByTestId('app-header')
    const ids = within(header)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid') ?? '')
    const wanted = ['header-goals', 'header-new-session', 'app-menu']
    expect(ids.filter((id) => wanted.includes(id))).toEqual(wanted)
    // An icon whose name slides out on hover or focus: the name is the button's own text.
    expect(screen.getByTestId('header-goals')).toHaveTextContent('Goals')
    expect(screen.getByTestId('header-goals')).toHaveAccessibleName('Goals')
  })

  it('clicking it opens the sheet; Escape closes it', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(screen.queryByTestId('goals-overlay')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('header-goals'))
    expect(screen.getByTestId('goals-overlay')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(screen.queryByTestId('goals-overlay')).not.toBeInTheDocument()
  })

  it('the sheet drops inside <main>: the header stays out of it, Goals closes it, the rest waits', async () => {
    const user = userEvent.setup()
    await renderApp()
    const goals = screen.getByTestId('header-goals')
    await user.click(goals)
    expect(within(screen.getByRole('main')).getByTestId('goals-overlay')).toBeInTheDocument()
    const header = screen.getByTestId('app-header')
    expect(within(header).queryByTestId('goals-overlay')).not.toBeInTheDocument()
    expect(goals).toHaveAttribute('aria-expanded', 'true')
    expect(goals).toHaveAttribute('data-lit')
    // The header stays live (Goals closes the sheet); its other controls wait.
    expect(header).not.toHaveAttribute('inert')
    const lead = screen.getByTestId('header-lead-group')
    const actions = screen.getByTestId('header-actions-group')
    expect(lead).toHaveAttribute('inert')
    expect(lead).toContainElement(screen.getByTestId('workspace-switcher'))
    expect(actions).toHaveAttribute('inert')
    expect(actions).toContainElement(screen.getByTestId('header-new-session'))
    expect(actions).not.toContainElement(goals)
    await user.click(goals)
    expect(screen.queryByTestId('goals-overlay')).not.toBeInTheDocument()
    expect(goals).toHaveAttribute('aria-expanded', 'false')
    expect(actions).not.toHaveAttribute('inert')
  })
})

describe('App — the Goals button count', () => {
  const task = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    workspaceId: 'default',
    goalId: null,
    title: id,
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
    ...over
  })
  const view = (tasks: unknown[]): unknown => ({
    goals: [],
    tasks,
    proposals: [],
    fileProblems: []
  })
  const three = [task('a'), task('b'), task('c'), task('x', { workspaceId: 'w2' })]
  // The pill is the only bare number in the button (its name is the text `Goals`).
  const pill = (): HTMLElement | null =>
    within(screen.getByTestId('header-goals')).queryByText(/^\d+$/)
  const pillCount = (): string | null => pill()?.getAttribute('data-count') ?? null

  beforeEach(() => {
    workspacesStore.setState({ activeId: 'default' })
    goalsStore.getState().hydrate({ goals: [], tasks: [], proposals: [], fileProblems: [] })
  })

  it('the Goals button shows the open-task count of the active workspace', async () => {
    stubAppBridges({ goals: { list: () => Promise.resolve(view(three) as never) } })
    await renderApp()
    await act(async () => {
      await loadGoals()
    })
    expect(pill()).toHaveTextContent('3')
    expect(pillCount()).toBe('open-tasks')
    expect(screen.getByTestId('header-goals')).toHaveAccessibleName('Goals, 3 open tasks')
  })

  it('no pill when every task is done', async () => {
    stubAppBridges({
      goals: { list: () => Promise.resolve(view([task('a', { status: 'done' })]) as never) }
    })
    await renderApp()
    await act(async () => {
      await loadGoals()
    })
    expect(pill()).toBeNull()
  })

  it('the count follows a goals push', async () => {
    stubAppBridges({ goals: { list: () => Promise.resolve(view(three) as never) } })
    await renderApp()
    await act(async () => {
      await loadGoals()
    })
    // goalsStore subscribes to the push once, at module load (goalsStore.test pins that), and
    // the push handler is `hydrate`: calling it is what a push does.
    act(() => {
      goalsStore
        .getState()
        .hydrate(view([task('a'), task('b'), task('c', { status: 'done' })]) as never)
    })
    expect(pill()).toHaveTextContent('2')
  })

  it('the count follows a workspace switch', async () => {
    stubAppBridges({ goals: { list: () => Promise.resolve(view(three) as never) } })
    await renderApp()
    await act(async () => {
      await loadGoals()
    })
    act(() => {
      workspacesStore.setState({ activeId: 'w2' })
    })
    expect(pill()).toHaveTextContent('1')
    expect(screen.getByTestId('header-goals')).toHaveAccessibleName('Goals, 1 open task')
  })

  it('no pill when the goals load failed', async () => {
    stubAppBridges({ goals: { list: () => Promise.reject(new Error('x')) } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await renderApp()
    await act(async () => {
      await loadGoals()
    })
    expect(pill()).toBeNull()
  })
})
