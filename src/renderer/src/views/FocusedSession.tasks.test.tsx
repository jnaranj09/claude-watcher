// The focused view's Tasks panel (spec 2026-10-19 E): when it shows, and that the terminal frames
// stay mounted around it. Its own file: Testing Library queries, like FocusedSession.context.test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stubXtermBrowserApis } from '../test/terminalHarness'
import { FocusedSession } from './FocusedSession'
import { boardStore } from '../stores/boardStore'
import { goalsStore } from '../stores/goalsStore'
import type { Task } from '../../../shared/ipc/contract'
import { watchUpdated } from '../../../__fixtures__/watchEvents'

let rendered: RenderResult | undefined

const linked: Task = {
  id: 't1',
  workspaceId: 'default',
  goalId: null,
  title: 'Write the spec',
  status: 'open',
  sessionIds: ['a'],
  createdAt: 1,
  doneAt: null,
  doneBy: null
}

beforeEach(() => {
  boardStore.setState({
    sessionsById: {},
    viewMode: 'focused',
    focusedTerminalId: null,
    terminalIdBySessionId: {},
    launchedTerminals: {},
    shellPanes: {}
  })
  stubXtermBrowserApis()
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { goals: unknown }).goals = { onChanged: vi.fn(() => () => {}) }
  boardStore.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
  boardStore.getState().addCorrelation('a', 'launch-a')
  boardStore.getState().switchTerminal('launch-a')
})

afterEach(() => {
  rendered?.unmount()
  rendered = undefined
  act(() => goalsStore.setState({ goals: [], tasks: [], loaded: false, loadFailed: false }))
})

function open(tasks: Task[]): void {
  act(() => goalsStore.setState({ goals: [], tasks, loaded: true, loadFailed: false }))
  rendered = render(<FocusedSession onBack={() => {}} onNewSession={() => {}} />)
}

describe('FocusedSession — the Tasks panel', () => {
  it('is hidden when nothing is linked and the toggle is off', () => {
    open([{ ...linked, sessionIds: [] }])
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).not.toHaveAttribute('data-lit')
  })

  it('shows when the session has a linked task, and the toggle is lit', () => {
    open([linked])
    expect(screen.getByTestId('session-tasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('data-lit')
  })

  it('the Tasks toggle opens and closes the panel on a session with no linked tasks', async () => {
    const user = userEvent.setup()
    open([])
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.getByTestId('session-tasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('data-lit')
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
  })

  it('the terminal frame stays mounted when the panel opens, and the panel is not in it', async () => {
    const user = userEvent.setup()
    open([])
    const frame = screen.getByTestId('embedded-terminal')
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.getByTestId('embedded-terminal')).toBe(frame)
    expect(frame).not.toContainElement(screen.getByTestId('session-tasks'))
  })
})
