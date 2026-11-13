// TaskRow's open state (spec 2026-10-29 task read more + edit). jsdom cannot see CSS, so the wrap
// is checked on the sheet's text; the markup checks show the task panel's row is unchanged.
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TaskRow } from './TaskRow'
import styles from './TaskRow.module.css'
import { cssRule } from '../../test/cssRule'
import type { Task } from '../../../../shared/schemas/goal'

/** The element's whole text, exactly (toHaveTextContent alone matches a part). */
const whole = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

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

  it('a task with a check shows the Check line, the recipe in mono', () => {
    const { unmount } = render(
      <TaskRow
        task={{ ...task, check: 'grep -n "sandbox: true" config/app.yml' }}
        onToggle={() => {}}
      />
    )
    const line = screen.getByTestId('task-check-t1')
    expect(line).toHaveTextContent(whole('Check: grep -n "sandbox: true" config/app.yml'))
    expect(line).toHaveAttribute('title', 'Check: grep -n "sandbox: true" config/app.yml')
    expect(within(line).getByText('grep -n "sandbox: true" config/app.yml')).toHaveClass(
      String(styles.recipe)
    )
    expect(cssRule('components/TaskRow/TaskRow.module.css', '.recipe')).toMatch(
      /font-family:\s*var\(--font-mono\)/
    )
    unmount()
  })

  it('a task with no check shows no Check line', () => {
    const { unmount } = render(<TaskRow task={task} onToggle={() => {}} />)
    expect(screen.queryByTestId('task-check-t1')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Check:/)).not.toBeInTheDocument()
    unmount()
  })

  it('an open task reported done shows who reported it, when, and the evidence; a done task does not', () => {
    const at = new Date(2026, 10, 12, 14, 30).getTime()
    const report = {
      at,
      sessionId: 's1',
      sessionName: 'fix api port',
      outcome: 'done',
      evidence: 'config/app.yml line 14 reads "sandbox: true"'
    } as const
    const open = render(<TaskRow task={{ ...task, report }} onToggle={() => {}} />)
    expect(screen.getByTestId('task-report-t1')).toHaveTextContent(
      whole(`Reported done by "fix api port" ${new Date(at).toLocaleString()}`)
    )
    expect(screen.getByTestId('task-report-evidence-t1')).toHaveTextContent(
      whole('config/app.yml line 14 reads "sandbox: true"')
    )
    // Only a flag: the row is not drawn closed and Done is still the operator's.
    expect(screen.getByRole('listitem')).toHaveAttribute('data-done', 'false')
    expect(screen.getByRole('button', { name: 'Done Write the spec' })).toBeInTheDocument()
    open.unmount()

    const closed = render(
      <TaskRow task={{ ...task, status: 'done', doneAt: 2, report }} onToggle={() => {}} />
    )
    expect(screen.queryByTestId('task-report-t1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-report-evidence-t1')).not.toBeInTheDocument()
    closed.unmount()
  })

  it('an open report shows no Reported done line', () => {
    const report = {
      at: 5,
      sessionId: 's1',
      sessionName: 'fix api port',
      outcome: 'open',
      evidence: 'still failing'
    } as const
    const { unmount } = render(<TaskRow task={{ ...task, report }} onToggle={() => {}} />)
    expect(screen.queryByTestId('task-report-t1')).not.toBeInTheDocument()
    expect(screen.queryByText('still failing')).not.toBeInTheDocument()
    unmount()
  })

  it('saved text in the lines is text only: angle brackets stay plain and a 300-character recipe has its title', () => {
    const check = `<script>x</script>${'y'.repeat(282)}`
    const { unmount } = render(<TaskRow task={{ ...task, check }} onToggle={() => {}} />)
    const line = screen.getByTestId('task-check-t1')
    expect(line).toHaveTextContent(whole(`Check: ${check}`))
    expect(line).toHaveAttribute('title', `Check: ${check}`)
    unmount()
  })

  it('the lines sit on their own full-width line; closed they end in …, open they wrap', () => {
    expect(cssRule('components/TaskRow/TaskRow.module.css', '.row')).toMatch(/flex-wrap:\s*wrap/)
    expect(cssRule('components/TaskRow/TaskRow.module.css', '.notes')).toMatch(/flex:\s*1 0 100%/)
    const note = cssRule('components/TaskRow/TaskRow.module.css', '.note')
    expect(note).toMatch(/text-overflow:\s*ellipsis/)
    expect(note).toMatch(/white-space:\s*nowrap/)
    const open = cssRule('components/TaskRow/TaskRow.module.css', ".row[data-open='true'] .note")
    expect(open).toMatch(/white-space:\s*normal/)
    expect(open).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('a row with a select box takes the shared hover', () => {
    expect(
      cssRule('components/TaskRow/TaskRow.module.css', '.row:has(> .main > .label):hover')
    ).toMatch(/background-image:\s*linear-gradient\(var\(--bg-hover\), var\(--bg-hover\)\)/)
  })

  it('with a select box the lines start under the title; the task panel (no select box) starts them at the inset', () => {
    const checked = { ...task, check: 'make test' }
    const sheet = render(
      <TaskRow task={checked} onToggle={() => {}} leading={<input type="checkbox" />} />
    )
    expect(screen.getByTestId('task-notes-indent-t1')).toBeInTheDocument()
    sheet.unmount()
    const panel = render(<TaskRow task={checked} onToggle={() => {}} />)
    expect(screen.getByTestId('task-check-t1')).toBeInTheDocument()
    expect(screen.queryByTestId('task-notes-indent-t1')).not.toBeInTheDocument()
    panel.unmount()
  })

  it('a long session name is the part cut on the Reported done line; the date always shows (R47)', () => {
    const at = new Date(2026, 10, 12, 14, 30).getTime()
    const name = 'n'.repeat(200)
    const report = {
      at,
      sessionId: 's1',
      sessionName: name,
      outcome: 'done',
      evidence: 'ok'
    } as const
    const { unmount } = render(<TaskRow task={{ ...task, report }} onToggle={() => {}} />)
    const line = screen.getByTestId('task-report-t1')
    expect(line).toHaveTextContent(
      whole(`Reported done by "${name}" ${new Date(at).toLocaleString()}`)
    )
    expect(within(line).getByText(name)).toHaveClass(String(styles.reportName))
    expect(within(line).getByText(`" ${new Date(at).toLocaleString()}`)).toHaveClass(
      String(styles.reportFixed)
    )
    unmount()
    const css = 'components/TaskRow/TaskRow.module.css'
    expect(cssRule(css, '.report')).toMatch(/display:\s*flex/)
    const nameRule = cssRule(css, '.reportName')
    expect(nameRule).toMatch(/flex:\s*0 1 auto/)
    expect(nameRule).toMatch(/min-width:\s*0/)
    expect(nameRule).toMatch(/text-overflow:\s*ellipsis/)
    expect(cssRule(css, '.reportFixed')).toMatch(/flex:\s*none/)
    expect(cssRule(css, ".row[data-open='true'] .report")).toMatch(/display:\s*block/)
  })
})
