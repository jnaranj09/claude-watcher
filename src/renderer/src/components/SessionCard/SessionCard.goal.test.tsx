// SessionCard — the goal line (spec 2026-10-19 Decisions D): `<goal> +N · n tasks` under the detail.
import { describe, it, expect, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { SessionCard, type SessionCardProps } from './SessionCard'
import { renderComponent } from '../../test/renderComponent'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function baseProps(overrides: Partial<SessionCardProps> = {}): SessionCardProps {
  return {
    variant: 'hero',
    sessionName: 'deploy-prod',
    projectPath: '~/work/acme/api',
    status: 'needs-you',
    accent: 'needs-you',
    pid: 4242,
    ...overrides
  }
}

describe('SessionCard goal line', () => {
  it('renders "<goal> · 2 tasks" under the detail line', () => {
    const { unmount } = renderComponent(
      <SessionCard
        {...baseProps({
          pendingToolDetail: 'rm -rf dist',
          goal: { name: 'Ship v2', extraGoals: 0, taskCount: 2 }
        })}
      />
    )
    cleanup = unmount
    const line = screen.getByTestId('goal-line')
    expect(line).toHaveTextContent('Ship v2 · 2 tasks')
    const detail = screen.getByTestId('pending-tool-detail')
    const footer = screen.getByTestId('footer')
    expect(detail.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says "1 task" for a single task', () => {
    const { unmount } = renderComponent(
      <SessionCard {...baseProps({ goal: { name: 'Ship v2', extraGoals: 0, taskCount: 1 } })} />
    )
    cleanup = unmount
    expect(screen.getByTestId('goal-line')).toHaveTextContent('Ship v2 · 1 task')
  })

  it('adds " +1" when tasks span two goals', () => {
    const { unmount } = renderComponent(
      <SessionCard {...baseProps({ goal: { name: 'Ship v2', extraGoals: 1, taskCount: 3 } })} />
    )
    cleanup = unmount
    expect(screen.getByTestId('goal-line')).toHaveTextContent('Ship v2 +1 · 3 tasks')
  })

  it('renders nothing without the goal prop', () => {
    const { unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(screen.queryByTestId('goal-line')).not.toBeInTheDocument()
  })

  it('the name truncates and keeps a title', () => {
    const { unmount } = renderComponent(
      <SessionCard
        {...baseProps({ goal: { name: 'A very long goal name', extraGoals: 1, taskCount: 2 } })}
      />
    )
    cleanup = unmount
    const name = screen.getByTestId('goal-name')
    expect(name).toHaveTextContent('A very long goal name')
    expect(name).toHaveAttribute('title', 'A very long goal name')
  })
})
