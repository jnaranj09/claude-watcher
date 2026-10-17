// moveMenuRow (menuArrows.ts): the arrows move a menu's rows and leave every other target alone.
import { afterEach, describe, it, expect } from 'vitest'
import type { JSX } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { moveMenuRow } from './menuArrows'

const mounted: (() => void)[] = []
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

function Menu(): JSX.Element {
  return (
    <div onKeyDown={(e) => moveMenuRow(e)}>
      <div role="menu">
        <button role="menuitem">one</button>
        <button role="menuitem">two</button>
        <input aria-label="find" />
      </div>
      <button aria-label="day">day</button>
    </div>
  )
}

describe('moveMenuRow', () => {
  it('moves a row and takes the key, so a scrolling list does not scroll too', () => {
    mounted.push(render(<Menu />).unmount)
    const one = screen.getByRole('menuitem', { name: 'one' })
    one.focus()
    expect(fireEvent.keyDown(one, { key: 'ArrowDown' })).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'two' })).toHaveFocus()
  })

  it('leaves the arrows of a non-row target alone, inside a menu or outside one', () => {
    mounted.push(render(<Menu />).unmount)
    const find = screen.getByRole('textbox', { name: 'find' })
    find.focus()
    expect(fireEvent.keyDown(find, { key: 'ArrowUp' })).toBe(true)
    expect(find).toHaveFocus()
    const day = screen.getByRole('button', { name: 'day' })
    day.focus()
    expect(fireEvent.keyDown(day, { key: 'ArrowDown' })).toBe(true)
    expect(day).toHaveFocus()
  })
})
