// Popover.Submenu — the ONE "row that opens a list beside it" (AppMenu's Tags / Sessions, the filter
// bar's type menu). jsdom `unit` project.
import { afterEach, describe, it, expect, vi, type Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { Popover } from './Popover'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
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

  it('marks which side it opens on, for the stylesheet', () => {
    setup(true, 'left')
    expect(screen.getByTestId('sub-list')).toHaveAttribute('data-side', 'left')
  })
})
