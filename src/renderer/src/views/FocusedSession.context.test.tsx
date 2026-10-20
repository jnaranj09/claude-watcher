// The focused header's Context button (spec 2026-10-18 §5): left of Shell, opens Context for the
// focused terminal. Its own file: Testing Library queries here, the older FocusedSession tests
// read the container.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stubXtermBrowserApis } from '../test/terminalHarness'
import { FocusedSession } from './FocusedSession'
import { boardStore } from '../stores/boardStore'

let rendered: RenderResult | undefined

beforeEach(() => {
  boardStore.setState({
    sessionsById: {},
    viewMode: 'focused',
    focusedTerminalId: null,
    terminalIdBySessionId: {},
    launchedTerminals: {},
    shellPanes: {},
    contextDialogTerminalId: null
  })
  stubXtermBrowserApis()
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
})

afterEach(() => {
  rendered?.unmount()
  rendered = undefined
})

describe('FocusedSession — the Context button', () => {
  it('is a secondary sm button placed before Shell', () => {
    boardStore.getState().openLaunchedTerminal('launch-a', 'a', 'default')
    rendered = render(<FocusedSession onBack={() => {}} onNewSession={() => {}} />)
    const context = screen.getByRole('button', { name: 'Context' })
    expect(context).toHaveAttribute('data-variant', 'secondary')
    expect(context).toHaveAttribute('data-size', 'sm')
    const order = screen.getAllByRole('button')
    expect(order.indexOf(context)).toBeLessThan(order.indexOf(screen.getByTestId('focused-shell')))
  })

  it('opens Context for the focused terminal', async () => {
    boardStore.getState().openLaunchedTerminal('launch-a', 'a', 'default')
    rendered = render(<FocusedSession onBack={() => {}} onNewSession={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Context' }))
    expect(boardStore.getState().contextDialogTerminalId).toBe('launch-a')
  })
})
