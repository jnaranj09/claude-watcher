// TaskRow's open state (spec 2026-10-29 task read more + edit). jsdom cannot see CSS, so the wrap
// is checked on the sheet's text; the markup checks show the task panel's row is unchanged.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskRow } from './TaskRow'
import { cssRule } from '../../test/cssRule'
import type { Task } from '../../../../shared/schemas/goal'

const task: Task = {
  id: 't1',
  workspaceId: 'w1',
  goalId: null,
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
  folder: null
}

describe('TaskRow', () => {
  it('an open row wraps its whole title instead of cutting it', () => {
    const rule = cssRule('components/TaskRow/TaskRow.module.css', ".row[data-open='true'] .title")
    expect(rule).toMatch(/white-space:\s*normal/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('without open or editor the row is closed and shows its title and Done', () => {
    const { unmount } = render(<TaskRow task={task} onToggle={() => {}} />)
    expect(screen.getByRole('listitem')).toHaveAttribute('data-open', 'false')
    expect(screen.getByText('Write the spec')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeInTheDocument()
    unmount()
  })

  it('an editor replaces the title and Done', () => {
    const { unmount } = render(
      <TaskRow task={task} onToggle={() => {}} editor={<span>field</span>} />
    )
    expect(screen.getByText('field')).toBeInTheDocument()
    expect(screen.queryByText('Write the spec')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done Write the spec' })).not.toBeInTheDocument()
    unmount()
  })

  it('the sessions line shows under the title, and not while the editor is open', () => {
    const line = <span>build-api</span>
    const first = render(<TaskRow task={task} onToggle={() => {}} sessions={line} />)
    expect(screen.getByText('build-api')).toBeInTheDocument()
    first.unmount()
    const editing = render(
      <TaskRow task={task} onToggle={() => {}} sessions={line} editor={<span>field</span>} />
    )
    expect(screen.queryByText('build-api')).not.toBeInTheDocument()
    editing.unmount()
  })
})
