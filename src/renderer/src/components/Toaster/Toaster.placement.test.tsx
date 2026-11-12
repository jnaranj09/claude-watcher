// The Toaster's two stacks (operator, 2026-11-12). A board toast keeps the window corner, dialog
// open or not. A dialog's own result toast (`dialogToastKey`) sits inside the open dialog's panel
// (`[data-toast-anchor]`): the Toaster writes `toastPlacement`'s answer on the dialog stack only.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import { Toaster } from './Toaster'
import { createToastStore, dialogToastKey } from '../../stores/toastStore'
import { manualClock } from '../../test/manualClock'
import { cssRule } from '../../test/cssRule'

let unmount: (() => void) | undefined
let panel: HTMLElement | undefined
function setup(): ReturnType<typeof createToastStore> {
  const store = createToastStore(manualClock())
  unmount = render(<Toaster store={store} />).unmount
  return store
}
afterEach(() => {
  unmount?.()
  unmount = undefined
  panel?.remove()
  panel = undefined
})

describe('Toaster — placement', () => {
  /** A dialog panel 50px in from the window's right edge and 40px up from its bottom. */
  async function openPanel(): Promise<void> {
    const el = document.createElement('div')
    el.setAttribute('data-toast-anchor', '')
    el.getBoundingClientRect = () =>
      ({
        top: 40,
        right: window.innerWidth - 50,
        bottom: window.innerHeight - 40,
        width: 900
      }) as DOMRect
    panel = el
    await act(async () => {
      document.body.append(el)
      await Promise.resolve()
    })
  }

  it("a dialog's toast moves inside a dialog panel that opens while it is showing", async () => {
    const store = setup()
    act(() => {
      store.getState().push({ kind: 'success', title: 'Saved', key: dialogToastKey('settings') })
    })
    const stack = screen.getByTestId('toast-stack-dialog')
    expect(within(stack).getByText('Saved')).toBeInTheDocument()
    expect(stack.style.getPropertyValue('--toast-bottom')).toBe('0px')
    expect(stack.style.getPropertyValue('--toast-room')).toBe('')
    await openPanel()
    expect(stack.style.getPropertyValue('--toast-right')).toBe('50px')
    expect(stack.style.getPropertyValue('--toast-bottom')).toBe('40px')
    expect(stack.style.getPropertyValue('--toast-room')).toBe('900px')
  })

  // The operator's report (2026-11-12): `Archived "<name>"` jumped from the window corner into the
  // name prompt when it opened.
  it('a board toast stays in the window corner when a dialog panel opens', async () => {
    const store = setup()
    act(() => {
      store.getState().push({ kind: 'success', title: 'Archived "api"' })
      store.getState().push({ kind: 'error', title: 'No', key: dialogToastKey('session-name') })
    })
    await openPanel()
    const board = screen.getByTestId('toast-stack-board')
    expect(within(board).getByText('Archived "api"')).toBeInTheDocument()
    expect(within(board).queryByText('No')).not.toBeInTheDocument()
    expect(board.style.getPropertyValue('--toast-right')).toBe('')
    expect(board.style.getPropertyValue('--toast-bottom')).toBe('')
    expect(board.style.getPropertyValue('--toast-room')).toBe('')
  })

  it('a stack sits a --space-4 inside its placement, no wider than the room', () => {
    const stack = cssRule('components/Toaster/Toaster.module.css', '.stack')
    expect(stack).toMatch(/right:\s*calc\(var\(--toast-right,\s*0px\)\s*\+\s*var\(--space-4\)\);/)
    expect(stack).toMatch(/bottom:\s*calc\(var\(--toast-bottom,\s*0px\)\s*\+\s*var\(--space-4\)\);/)
    expect(stack).toMatch(
      /width:\s*min\(360px,\s*calc\(var\(--toast-room,\s*100vw\)\s*-\s*2\s*\*\s*var\(--space-4\)\)\);/
    )
  })
})
