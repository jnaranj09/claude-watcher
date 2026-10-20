// The header's Goals button — App-level wiring (spec 2026-10-19-goals): it sits between
// `+ New session` and the ☰ menu, opens the Goals sheet under the single-modal rule, and Escape from
// the page body closes it. Fake window bridges from the shared App harness, no Electron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { unmountRendered } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges } from './test/appHarness'

beforeEach(() => {
  resetBoardView()
  stubAppBridges({ launch: { pickDirectory: vi.fn(() => Promise.resolve('/home/op/project')) } })
})
afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
})

describe('App — the Goals button', () => {
  it('the header shows the Goals icon button left of + New session', async () => {
    await renderApp()
    const header = screen.getByTestId('app-header')
    const ids = within(header)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid') ?? '')
    const wanted = ['header-goals', 'header-new-session', 'app-menu']
    expect(ids.filter((id) => wanted.includes(id))).toEqual(wanted)
    // An icon: no visible text, named for screen readers and on hover.
    expect(screen.getByTestId('header-goals')).toHaveTextContent('')
    expect(screen.getByTestId('header-goals')).toHaveAccessibleName('Goals')
    expect(screen.getByTestId('header-goals')).toHaveAttribute('title', 'Goals')
  })

  it('clicking it opens the sheet; Escape closes it', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(screen.queryByTestId('goals-overlay')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('header-goals'))
    expect(screen.getByTestId('goals-overlay')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(screen.queryByTestId('goals-overlay')).not.toBeInTheDocument()
  })
})
