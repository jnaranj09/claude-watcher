// The footer sits UNDER the scroll body, never over it (spec 2026-10-29 goals page polish A): a
// long form scrolls inside its body, `[Delete] [Save]` stay in view below it, and the body fades
// its end while more is below (the rail's end fade). A Footer nested anywhere in a Form or Pane
// (Context history's Restore sits in a fragment) lands in the same slot.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, useEffect, type JSX, type ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManageDialog, useManageDialog } from './ManageDialog'

// This repo's setup runs no RTL auto-cleanup (src/renderer/src/test/setup.ts): each test
// unmounts what it rendered.
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})
function show(ui: JSX.Element): void {
  unmount = render(ui).unmount
}

function Shell({ children }: { children: ReactNode }): JSX.Element {
  const dialog = useManageDialog({ title: 'Things', testIdPrefix: 'things', onClose: () => {} })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Columns>{children}</ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

function FormHarness({ onSubmit }: { onSubmit: () => void }): JSX.Element {
  return (
    <Shell>
      <ManageDialog.Form
        testId="things-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <ManageDialog.Label>Name</ManageDialog.Label>
        <div data-testid="things-nested" />
        <ManageDialog.Footer>
          <ManageDialog.Save testId="things-save" disabled={false} />
        </ManageDialog.Footer>
      </ManageDialog.Form>
    </Shell>
  )
}

function PaneHarness(): JSX.Element {
  return (
    <Shell>
      <ManageDialog.Pane testId="things-pane">
        <div>
          <>
            <p>History</p>
            <ManageDialog.Footer>
              <ManageDialog.Save testId="things-restore" disabled={false} onClick={() => {}}>
                Restore
              </ManageDialog.Save>
            </ManageDialog.Footer>
          </>
        </div>
      </ManageDialog.Pane>
    </Shell>
  )
}

function setBox(el: HTMLElement, box: { clientHeight: number; scrollHeight: number }): void {
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: box.clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: box.scrollHeight })
}

describe('ManageDialog footer slot', () => {
  it('a Form puts its Footer outside the scroll body, still inside the form', () => {
    show(<FormHarness onSubmit={() => {}} />)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(
      within(screen.getByTestId('things-form-scroll')).queryByRole('button', { name: 'Save' })
    ).not.toBeInTheDocument()
    expect(within(screen.getByTestId('things-form')).getByRole('button', { name: 'Save' })).toBe(
      save
    )
  })

  it('Save in the slot still submits the form', async () => {
    const onSubmit = vi.fn()
    show(<FormHarness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a Footer nested in a fragment inside a Pane also leaves the scroll body', () => {
    show(<PaneHarness />)
    expect(
      within(screen.getByTestId('things-pane-scroll')).queryByRole('button', { name: 'Restore' })
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('things-pane')).getByRole('button', { name: 'Restore' })
    ).toBeVisible()
  })

  it('the footer keeps its theme hook and the toast clearance', () => {
    show(<FormHarness onSubmit={() => {}} />)
    const footer = screen.getByTestId('things-form-footer')
    expect(footer).toHaveAttribute('data-manage-footer')
    expect(footer).toHaveAttribute('data-toast-clearance')
  })
})

function MountProbe({ onMount }: { onMount: () => void }): JSX.Element {
  useEffect(onMount, [onMount])
  return <span />
}

describe('ManageDialog footer slot — mounting', () => {
  it('a Footer child mounts once: never drawn inline first, then moved', () => {
    const onMount = vi.fn()
    show(
      <Shell>
        <ManageDialog.Form testId="things-form" onSubmit={(e) => e.preventDefault()}>
          <ManageDialog.Footer>
            <MountProbe onMount={onMount} />
          </ManageDialog.Footer>
        </ManageDialog.Form>
      </Shell>
    )
    expect(onMount).toHaveBeenCalledTimes(1)
  })

  it('a Footer outside any Form or Pane draws in place', () => {
    show(
      <Shell>
        <ManageDialog.Footer>
          <ManageDialog.Save testId="things-save" disabled={false} />
        </ManageDialog.Footer>
      </Shell>
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

describe('ManageDialog scroll body — the end fade', () => {
  it('fades while content sits below the visible end', () => {
    show(<FormHarness onSubmit={() => {}} />)
    const body = screen.getByTestId('things-form-scroll')
    setBox(body, { clientHeight: 100, scrollHeight: 300 })
    fireEvent.scroll(body)
    expect(body).toHaveAttribute('data-overflow-end')
  })

  it('no fade when everything fits', () => {
    show(<FormHarness onSubmit={() => {}} />)
    const body = screen.getByTestId('things-form-scroll')
    setBox(body, { clientHeight: 300, scrollHeight: 300 })
    fireEvent.scroll(body)
    expect(body).not.toHaveAttribute('data-overflow-end')
  })

  it('re-checks when content is added deep inside, without a scroll (a new task)', async () => {
    show(<FormHarness onSubmit={() => {}} />)
    const body = screen.getByTestId('things-form-scroll')
    setBox(body, { clientHeight: 100, scrollHeight: 300 })
    expect(body).not.toHaveAttribute('data-overflow-end')
    await act(async () => {
      screen.getByTestId('things-nested').append(document.createElement('div'))
      await Promise.resolve() // MutationObserver callbacks run as a microtask
    })
    expect(body).toHaveAttribute('data-overflow-end')
  })
})
