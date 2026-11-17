// A reveal Button's count pill. A separate file from Button.test.tsx: that one still reads through
// `container` (the lint budget is draining it), and importing `screen` there would switch the
// testing-library node-access rule on for every old line.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button, type ButtonProps } from './Button'

// The setup runs no RTL `cleanup`: each test unmounts what it rendered.
let unmount: (() => void) | undefined

function goals(count: ButtonProps['count'], lit = false): void {
  unmount = render(
    <Button testId="btn" reveal="Goals" lit={lit} count={count}>
      <svg aria-hidden="true" data-testid="goals-icon" />
    </Button>
  ).unmount
}

const open3 = { value: 3, label: '3 open tasks', kind: 'open-tasks' } as const

describe('Button count', () => {
  afterEach(() => {
    unmount?.()
    unmount = undefined
  })

  it('a reveal button with a count draws the pill between the icon and the name', () => {
    goals(open3)
    const pill = screen.getByText('3')
    expect(pill).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Goals, 3 open tasks' })).toBeInTheDocument()
    // Order has no query: only document position tells the icon, pill and name apart.
    const follows = (a: Node, b: Node): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(screen.getByTestId('goals-icon'), pill)).toBe(true)
    expect(follows(pill, screen.getByText('Goals'))).toBe(true)
  })

  it('a count of 0 draws no pill and leaves the name alone', () => {
    goals({ value: 0, label: '0 open tasks', kind: 'open-tasks' })
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Goals' })).toBeInTheDocument()
  })

  it('the pill stays when the button is lit', () => {
    goals(open3, true)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
