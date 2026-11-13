// Memory phase 2 "Feedback" — App wiring: App subscribes once to main's result push and each
// result becomes its board toast; `Show` opens the Memory dialog on that session. Fake window
// bridges from the shared App harness, no Electron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MemoryExtractResult } from '../../shared/schemas/memory'
import { unmountRendered } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges } from './test/appHarness'
import { toastStore } from './stores/toastStore'

type Push = (result: MemoryExtractResult) => void
let subscribers: Set<Push>
let onExtractResult: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetBoardView()
  subscribers = new Set()
  onExtractResult = vi.fn((cb: Push) => {
    subscribers.add(cb)
    return () => subscribers.delete(cb)
  })
  stubAppBridges({ memory: { onExtractResult } })
})
afterEach(() => {
  unmountRendered()
  act(() => toastStore.setState({ toasts: [] }))
  vi.restoreAllMocks()
})

const SAVED: MemoryExtractResult = {
  sessionName: 'fix api port',
  trigger: 'end',
  outcome: 'saved',
  counts: { specifics: 4, facts: 1, tasks: 2, episodes: 1 },
  reason: null
}

/** Main's push. The toasts start empty: the harness leaves some stores unstubbed, and App's startup
 *  toast about them is not what these tests read. */
function fromMain(result: MemoryExtractResult): void {
  act(() => {
    toastStore.setState({ toasts: [] })
    for (const cb of subscribers) cb(result)
  })
}

describe('App — the result toasts of a save from a session', () => {
  it('subscribes once and shows each result as a board toast', async () => {
    await renderApp()
    expect(subscribers.size).toBe(1)
    fromMain(SAVED)
    const card = screen.getByTestId('toast')
    expect(within(card).getByText('Memory saved from "fix api port".')).toBeVisible()
    expect(within(card).getByText('6 saved to memory, 2 tasks')).toBeVisible()
  })

  it('Show opens the Memory dialog', async () => {
    const user = userEvent.setup()
    await renderApp()
    fromMain(SAVED)
    await user.click(within(screen.getByTestId('toast')).getByRole('button', { name: 'Show' }))
    expect(await screen.findByRole('dialog', { name: 'Memory' })).toBeVisible()
  })

  it('unmounting App unsubscribes', async () => {
    const r = await renderApp()
    r.unmount()
    expect(subscribers.size).toBe(0)
  })
})
