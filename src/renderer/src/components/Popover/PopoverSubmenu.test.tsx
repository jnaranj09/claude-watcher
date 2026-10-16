// Popover.Submenu — the ONE "row that opens a list beside it" (AppMenu's Tags / Sessions, the filter
// bar's type menu). jsdom `unit` project.
import { afterEach, describe, it, expect, vi, type Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type JSX } from 'react'
import { Popover } from './Popover'
import { Presence } from '../Presence/Presence'
import { pointerInput } from '../../test/pointerInput'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let unmount: (() => void) | undefined
let clearInput: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
  clearInput?.()
  clearInput = undefined
})

function setup(
  open: boolean,
  side: 'left' | 'right'
): { onOpen: Mock; onOpenFromKey: Mock; onBack: Mock } {
  const onOpen = vi.fn()
  const onOpenFromKey = vi.fn()
  const onBack = vi.fn()
  ;({ unmount } = render(
    <div role="menu" aria-label="Root">
      <Popover.Submenu
        label="Folder"
        icon={<span />}
        side={side}
        open={open}
        focusRequest={0}
        triggerRef={createRef()}
        onOpen={onOpen}
        onOpenFromKey={onOpenFromKey}
        onBack={onBack}
        testId="sub"
        listTestId="sub-list"
      >
        <Popover.Item role="menuitem">One</Popover.Item>
      </Popover.Submenu>
    </div>
  ))
  return { onOpen, onOpenFromKey, onBack }
}

describe('Popover.Submenu', () => {
  it('hover OPENS and does not toggle', async () => {
    const { onOpen } = setup(false, 'right')
    const row = screen.getByRole('menuitem', { name: /Folder/ })
    await userEvent.hover(row)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(row).toHaveAttribute('aria-expanded', 'false')
  })

  it('a click with no pointer entry still OPENS', () => {
    const { onOpen } = setup(false, 'right')
    fireEvent.click(screen.getByRole('menuitem', { name: /Folder/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('ArrowRight opens from the keyboard; ArrowLeft in the list goes back', async () => {
    const { onOpenFromKey, onBack } = setup(true, 'right')
    screen.getByRole('menuitem', { name: /Folder/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onOpenFromKey).toHaveBeenCalledOnce()
    screen.getByRole('menuitem', { name: 'One' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('a key open focuses the first row, whatever its menu role (checkbox and radio rows too)', () => {
    ;({ unmount } = render(
      <div role="menu" aria-label="Root">
        <Popover.Submenu
          label="Tag"
          icon={<span />}
          side="right"
          open
          focusRequest={1}
          triggerRef={createRef()}
          onOpen={vi.fn()}
          onOpenFromKey={vi.fn()}
          onBack={vi.fn()}
          testId="sub"
          listTestId="sub-list"
        >
          <Popover.Item role="menuitemcheckbox" aria-checked={false}>
            api
          </Popover.Item>
        </Popover.Submenu>
      </div>
    ))
    expect(screen.getByRole('menuitemcheckbox', { name: 'api' })).toHaveFocus()
  })

  it('inside a leaving Presence its list wrapper is marked data-leaving and inert', () => {
    clearInput = pointerInput()
    const tree = (shown: boolean): JSX.Element => (
      <Presence value={shown || null}>
        {() => (
          <div role="menu" aria-label="Root">
            <Popover.Submenu
              label="Folder"
              icon={<span />}
              side="right"
              open
              focusRequest={0}
              triggerRef={createRef()}
              onOpen={vi.fn()}
              onOpenFromKey={vi.fn()}
              onBack={vi.fn()}
              testId="sub"
              listTestId="sub-list"
            >
              <Popover.Item role="menuitem">One</Popover.Item>
            </Popover.Submenu>
          </div>
        )}
      </Presence>
    )
    const r = render(tree(true))
    unmount = r.unmount
    expect(screen.getByTestId('sub-list-wrap')).not.toHaveAttribute('data-leaving')
    r.rerender(tree(false))
    expect(screen.getByTestId('sub-list-wrap')).toHaveAttribute('data-leaving')
    expect(screen.getByTestId('sub-list-wrap')).toHaveAttribute('inert')
  })

  it('marks which side it opens on, for the stylesheet', () => {
    setup(true, 'left')
    expect(screen.getByTestId('sub-list')).toHaveAttribute('data-side', 'left')
  })
})
