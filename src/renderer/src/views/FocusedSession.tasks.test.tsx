// The focused view's Tasks panel (spec 2026-10-19 E): when it shows, and that the terminal frames
// stay mounted around it. Its own file: Testing Library queries, like FocusedSession.context.test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  doneBy: null,
  check: null,
  leftWith: null,
  lastSeenAt: null,
  report: null,
  originSessionId: null,
  folder: null,
  touchedBy: []
}

beforeEach(() => {
  boardStore.setState({
    sessionsById: {},
    viewMode: 'focused',
    focusedTerminalId: null,
    terminalIdBySessionId: {},
    launchedTerminals: {},
    shellPanes: {},
    tasksPanelOpenById: {}
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

  it('a drag line sits left of the panel; ArrowLeft widens the panel 20px, a double-click resets it', async () => {
    const user = userEvent.setup()
    open([linked])
    const line = screen.getByRole('separator', { name: 'Resize task panel' })
    expect(line).toHaveAttribute('aria-orientation', 'vertical')
    // Left of the panel: the line comes first in the row.
    const panel = screen.getByTestId('session-tasks')
    expect(line.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.getByTestId('session-tasks')).toHaveStyle({ width: '260px' })
    line.focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('session-tasks')).toHaveStyle({ width: '280px' })
    await user.dblClick(line)
    expect(screen.getByTestId('session-tasks')).toHaveStyle({ width: '260px' })
  })

  // A theme insets the terminal frame its own way (Paper 20px, Default 12px). With the panel open
  // the frame goes flush right, so the 12px drag line alone is the gap and its grip is centred in
  // every theme; the rule must out-rank a theme's `[data-focused-frames] > *`.
  it('with the panel open the frame goes flush right, so the drag line alone is the gap', async () => {
    const user = userEvent.setup()
    open([])
    expect(screen.getByTestId('focused-body')).not.toHaveAttribute('data-tasks-open')
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.getByTestId('focused-body')).toHaveAttribute('data-tasks-open')
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './FocusedSession.module.css'),
      'utf8'
    )
    expect(css).toMatch(/\.body\[data-tasks-open\] \.terminalWrap > \*\s*\{\s*right:\s*0;/)
  })

  it('the toggle hides a panel that opened for linked tasks, and shows it again', async () => {
    const user = userEvent.setup()
    open([linked])
    const toggle = screen.getByRole('button', { name: 'Tasks' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await user.click(toggle)
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
    expect(toggle).not.toHaveAttribute('data-lit')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(screen.getByTestId('session-tasks')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('data-lit')
  })

  it('unlinking the last task keeps the panel: the none-linked note and Link task', async () => {
    const user = userEvent.setup()
    ;(window as unknown as { goals: unknown }).goals = {
      onChanged: vi.fn(() => () => {}),
      unlinkTask: vi.fn(() => {
        const tasks = [{ ...linked, sessionIds: [] }]
        return Promise.resolve({ goals: [], tasks, proposals: [], fileProblems: [] })
      })
    }
    act(() => goalsStore.setState({ goals: [], tasks: [linked], loaded: true, loadFailed: false }))
    rendered = render(<FocusedSession onBack={() => {}} onNewSession={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Unlink Write the spec' }))
    expect(screen.getByTestId('session-tasks')).toHaveTextContent(
      'No tasks linked to this session.'
    )
    expect(screen.getByRole('button', { name: 'Link task' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('data-lit')
  })

  it('linking a task while the panel is closed does not open it', () => {
    open([{ ...linked, sessionIds: [] }])
    act(() => goalsStore.setState({ tasks: [linked] }))
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
  })

  it('the toggle is disabled when the focused terminal has no session', () => {
    boardStore.setState({
      sessionsById: {},
      terminalIdBySessionId: {},
      launchedTerminals: {}
    })
    boardStore.getState().openLaunchedTerminal('launch-x', 'x', 'default')
    act(() => goalsStore.setState({ goals: [], tasks: [], loaded: true, loadFailed: false }))
    rendered = render(<FocusedSession onBack={() => {}} onNewSession={() => {}} />)
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeDisabled()
  })

  it('each session keeps its own open/closed choice across a switch away and back', async () => {
    const user = userEvent.setup()
    boardStore.getState().applyWatchEvent(watchUpdated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('b', 'launch-b')
    open([])
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.getByTestId('session-tasks')).toBeInTheDocument()
    // b has made no choice yet: it starts from its own linked tasks (none here).
    act(() => boardStore.getState().switchTerminal('launch-b'))
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
    act(() => boardStore.getState().switchTerminal('launch-a'))
    expect(screen.getByTestId('session-tasks')).toBeInTheDocument()
  })

  it('hiding a panel that opened for linked tasks stays hidden after a switch away and back', async () => {
    const user = userEvent.setup()
    boardStore.getState().applyWatchEvent(watchUpdated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('b', 'launch-b')
    open([linked])
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
    act(() => boardStore.getState().switchTerminal('launch-b'))
    act(() => boardStore.getState().switchTerminal('launch-a'))
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a session never toggled takes its start from its linked tasks each time focus returns', () => {
    boardStore.getState().applyWatchEvent(watchUpdated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('b', 'launch-b')
    open([{ ...linked, sessionIds: [] }])
    act(() => goalsStore.setState({ tasks: [linked] }))
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
    act(() => boardStore.getState().switchTerminal('launch-b'))
    act(() => boardStore.getState().switchTerminal('launch-a'))
    expect(screen.getByTestId('session-tasks')).toBeInTheDocument()
  })

  it('the hidden choice survives the view remounting', async () => {
    const user = userEvent.setup()
    open([linked])
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    rendered?.unmount()
    rendered = render(<FocusedSession onBack={() => {}} onNewSession={() => {}} />)
    expect(screen.queryByTestId('session-tasks')).not.toBeInTheDocument()
  })
})
