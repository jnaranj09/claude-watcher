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

  it('the sheet drops inside <main>: the header stays out of it, Goals closes it, the rest waits', async () => {
    const user = userEvent.setup()
    await renderApp()
    const goals = screen.getByTestId('header-goals')
    await user.click(goals)
    expect(within(screen.getByRole('main')).getByTestId('goals-overlay')).toBeInTheDocument()
    const header = screen.getByTestId('app-header')
    expect(within(header).queryByTestId('goals-overlay')).not.toBeInTheDocument()
    expect(goals).toHaveAttribute('aria-expanded', 'true')
    expect(goals).toHaveAttribute('data-lit')
    // The header stays live (Goals closes the sheet); its other controls wait.
    expect(header).not.toHaveAttribute('inert')
    const lead = screen.getByTestId('header-lead-group')
    const actions = screen.getByTestId('header-actions-group')
    expect(lead).toHaveAttribute('inert')
    expect(lead).toContainElement(screen.getByTestId('workspace-switcher'))
    expect(actions).toHaveAttribute('inert')
    expect(actions).toContainElement(screen.getByTestId('header-new-session'))
    expect(actions).not.toContainElement(goals)
    await user.click(goals)
    expect(screen.queryByTestId('goals-overlay')).not.toBeInTheDocument()
    expect(goals).toHaveAttribute('aria-expanded', 'false')
    expect(actions).not.toHaveAttribute('inert')
  })
})
