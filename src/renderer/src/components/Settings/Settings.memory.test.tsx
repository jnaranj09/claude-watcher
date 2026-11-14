// Settings → Memory, the rows shown only while Memory is on: when and with which model memory
// saves from a session (memory phase 2), and recall while a session runs (memory phase 3). jsdom `unit` project; the real panel against a stubbed
// window.settings and the singleton settings store.
import { describe, it, expect, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from './Settings'
import { flush, renderTracked, unmountRendered } from '../../test/renderComponent'
import { stubSettings } from '../../test/settingsBridge'
import { resetSettingsPanel, stubThemes } from '../../test/settingsPanelHarness'
import { dialogToast } from '../../test/toasts'
import { settingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'

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

// Memory phase 3: recall while a session runs, the first row shown only while Memory is on.
describe('Settings → Memory — Memory recall', () => {
  async function openMemory(
    memoryEnabled: boolean,
    memoryRecallEnabled = true
  ): Promise<{ setCalls: unknown[] }> {
    const user = userEvent.setup()
    const stub = stubSettings()
    stubThemes()
    settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, memoryEnabled, memoryRecallEnabled })
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    return stub
  }

  it('Memory recall saves on change', async () => {
    const stub = await openMemory(true)
    expect(screen.getByRole('switch', { name: 'Memory recall' })).toBeChecked()
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Memory recall' }))
    await flush(2)
    expect(stub.setCalls.at(-1)).toEqual({ memoryRecallEnabled: false })
    expect(screen.getByRole('switch', { name: 'Memory recall' })).not.toBeChecked()
    expect(dialogToast('settings')?.title).toBe('Saved')
  })

  it('with Memory off there is no Memory recall control', async () => {
    await openMemory(false)
    expect(screen.queryByRole('switch', { name: 'Memory recall' })).not.toBeInTheDocument()
  })

  it('Memory recall is the first of the rows shown only while Memory is on', async () => {
    await openMemory(true)
    const recall = screen.getByRole('switch', { name: 'Memory recall' })
    const checkpoint = screen.getByRole('button', { name: 'Memory checkpoint' })
    const memory = screen.getByRole('switch', { name: 'Memory' })
    expect([
      memory.compareDocumentPosition(recall) & Node.DOCUMENT_POSITION_FOLLOWING,
      recall.compareDocumentPosition(checkpoint) & Node.DOCUMENT_POSITION_FOLLOWING
    ]).toEqual([Node.DOCUMENT_POSITION_FOLLOWING, Node.DOCUMENT_POSITION_FOLLOWING])
  })

  it('the hint says what recall does and which claude it needs, word for word', async () => {
    await openMemory(true)
    expect(
      screen.getByText(
        'While a session runs, Claude gets a fresh memory index after /clear and /compact, items that match each prompt, the keys saved for a folder when it opens a file there, and the /remember command. Needs Claude 2.1.323 or newer. A change applies to sessions started after it.'
      )
    ).toBeInTheDocument()
  })

  it('a refused change rolls back and names memory recall', async () => {
    const user = userEvent.setup()
    stubSettings(() => Promise.reject(new Error('settings_persist_failed')))
    stubThemes()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(screen.getByRole('switch', { name: 'Memory recall' }))
    await flush(3)
    expect(screen.getByRole('switch', { name: 'Memory recall' })).toBeChecked()
    expect(dialogToast('settings')?.title).toBe('Could not save memory recall.')
  })

  it('shows recall off when main says it is off', async () => {
    await openMemory(true, false)
    expect(screen.getByRole('switch', { name: 'Memory recall' })).not.toBeChecked()
  })

  it('flips the switch at once, before main answers', async () => {
    const user = userEvent.setup()
    stubSettings(() => new Promise(() => {}))
    stubThemes()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(screen.getByRole('switch', { name: 'Memory recall' }))
    expect(screen.getByRole('switch', { name: 'Memory recall' })).not.toBeChecked()
  })
})
