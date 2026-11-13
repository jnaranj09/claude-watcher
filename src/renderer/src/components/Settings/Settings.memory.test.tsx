// Settings → Memory, the phase 2 rows (memory phase 2 addendum "UI"): when and with which model
// memory saves from a session. jsdom `unit` project; the real panel against a stubbed
// window.settings and the singleton settings store.
import { describe, it, expect, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from './Settings'
import { flush, renderTracked, unmountRendered } from '../../test/renderComponent'
import { stubSettings } from '../../test/settingsBridge'
import { resetSettingsPanel, stubThemes } from '../../test/settingsPanelHarness'
import { dialogToast } from '../../test/toasts'

afterEach(() => {
  unmountRendered()
  resetSettingsPanel()
})

function renderPanel(): void {
  renderTracked(<SettingsPanel onClose={() => {}} />)
}

// The three rows sit under the Memory hint, and only while Memory is on.
describe('Settings → Memory — saving from a session', () => {
  const CHECKPOINT_HINT =
    'Saves from a running session every this many turns, so a long session or a crash loses nothing. Off: only when a session ends.'
  const TASKS_HINT =
    'Work a session leaves open becomes a task in Goals. Off: open work is not saved.'
  const MODEL_HINT =
    'The model that reads a session to save from it. It uses your Claude account, like a session does. Haiku uses less.'

  it('shows the three rows with their hints while Memory is on and none of them while it is off', async () => {
    const user = userEvent.setup()
    stubSettings()
    stubThemes()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))

    const checkpoint = screen.getByRole('button', { name: 'Memory checkpoint' })
    expect(checkpoint).toHaveTextContent('15 turns')
    expect(screen.getByText('Memory checkpoint', { selector: 'span' })).toBeVisible()
    expect(screen.getByText(CHECKPOINT_HINT)).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Save open work as tasks' })).toBeChecked()
    expect(screen.getByText(TASKS_HINT)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Memory model' })).toHaveTextContent('Sonnet')
    expect(screen.getByText(MODEL_HINT)).toBeVisible()

    // Order: Memory, its hint, the three rows, then Claude's auto memory.
    const pane = screen.getByTestId('settings-pane-memory')
    const order = [
      'Sessions this app starts can save exact values and facts, and find them again.',
      CHECKPOINT_HINT,
      TASKS_HINT,
      MODEL_HINT,
      "Claude Code's own memory"
    ].map((text) => pane.textContent?.indexOf(text) ?? -1)
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    await user.click(screen.getByRole('switch', { name: 'Memory' }))
    expect(screen.queryByRole('button', { name: 'Memory checkpoint' })).not.toBeInTheDocument()
    expect(screen.queryByText(CHECKPOINT_HINT)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Save open work as tasks' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(TASKS_HINT)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Memory model' })).not.toBeInTheDocument()
    expect(screen.queryByText(MODEL_HINT)).not.toBeInTheDocument()
    // Claude's own memory is not this app's: it stays.
    expect(screen.getByRole('button', { name: "Claude's auto memory" })).toBeVisible()
  })

  it('offers the checkpoint as Off, 10, 15 or 25 turns and the model as Haiku or Sonnet', async () => {
    const user = userEvent.setup()
    stubSettings()
    stubThemes()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(screen.getByRole('button', { name: 'Memory checkpoint' }))
    expect(
      within(screen.getByRole('listbox', { name: 'Memory checkpoint' }))
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Off', '10 turns', '15 turns', '25 turns'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Memory model' }))
    expect(
      within(screen.getByRole('listbox', { name: 'Memory model' }))
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Haiku', 'Sonnet'])
  })

  it('saves each choice: { memoryCheckpoint: 0 }, { memorySaveTasks: false }, { memoryModel: "haiku" }', async () => {
    const user = userEvent.setup()
    const stub = stubSettings()
    stubThemes()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(screen.getByRole('button', { name: 'Memory checkpoint' }))
    await user.click(screen.getByRole('option', { name: 'Off' }))
    await flush(2)
    expect(screen.getByRole('button', { name: 'Memory checkpoint' })).toHaveTextContent('Off')
    await user.click(screen.getByRole('switch', { name: 'Save open work as tasks' }))
    await flush(2)
    expect(screen.getByRole('switch', { name: 'Save open work as tasks' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Memory model' }))
    await user.click(screen.getByRole('option', { name: 'Haiku' }))
    await flush(2)
    expect(screen.getByRole('button', { name: 'Memory model' })).toHaveTextContent('Haiku')
    expect(stub.setCalls).toEqual([
      { memoryCheckpoint: 0 },
      { memorySaveTasks: false },
      { memoryModel: 'haiku' }
    ])
    expect(dialogToast('settings')?.title).toBe('Saved')
  })

  it('a refused change rolls back and says which setting did not save', async () => {
    const user = userEvent.setup()
    stubSettings(() => Promise.reject(new Error('settings_persist_failed')))
    stubThemes()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(screen.getByRole('button', { name: 'Memory model' }))
    await user.click(screen.getByRole('option', { name: 'Haiku' }))
    await flush(3)
    expect(screen.getByRole('button', { name: 'Memory model' })).toHaveTextContent('Sonnet')
    expect(dialogToast('settings')?.title).toBe('Could not save the memory model.')
  })
})
