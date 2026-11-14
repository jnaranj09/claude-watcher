// Context's Memory page, recall while a session runs (memory phase 3): the activity comes from the
// test bridge. jsdom `unit` project; the older Memory page tests stay in `ContextDialog.test.tsx`.
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MemoryActivity } from '../../../../shared/schemas/memory'
import {
  NOW,
  openContext,
  registerContextDialogHooks,
  stubMemory
} from '../../test/contextDialogHarness'

registerContextDialogHooks()

describe('ContextDialog — the Memory page, recall', () => {
  it('an injected entry is under none of Pulled, Saved and Dropped', async () => {
    stubMemory({
      injected: null,
      recall: { mode: 'mod' },
      entries: [
        { at: NOW - 60_000, action: 'injected', tool: 'prompt', itemId: 'm2', reason: null }
      ]
    })
    await openContext()
    await userEvent.click(screen.getByTestId('context-category-memory'))
    expect(
      ['pulled', 'saved', 'dropped'].map(
        (list) => screen.getByTestId(`context-memory-${list}`).textContent
      )
    ).toEqual([
      expect.stringContaining('Nothing pulled.'),
      expect.stringContaining('Nothing saved.'),
      expect.stringContaining('Nothing dropped.')
    ])
  })
})

describe('ContextDialog — the Memory page, what recall gave a session', () => {
  const RECALLED: MemoryActivity = {
    injected: { tokens: 120, itemIds: ['m1'] },
    recall: { mode: 'mod' },
    entries: [
      { at: NOW - 60_000, action: 'injected', tool: 'prompt', itemId: 'm2', reason: null },
      { at: NOW - 30_000, action: 'injected', tool: 'file', itemId: 'm3', reason: null },
      { at: NOW - 10_000, action: 'saved', tool: '/remember', itemId: 'm4', reason: null }
    ]
  }

  async function openMemoryPage(activity: MemoryActivity): Promise<void> {
    stubMemory(activity)
    await openContext()
    await userEvent.click(screen.getByTestId('context-category-memory'))
  }

  it('lists a recalled item under Injected, with how it was given', async () => {
    await openMemoryPage(RECALLED)
    const injected = within(await screen.findByTestId('context-memory-injected-section'))
    expect(injected.getByTestId('context-memory-injected')).toHaveTextContent(
      /^Index: 120 tokens · 1 item$/
    )
    expect(injected.getAllByTestId('context-memory-entry').map((row) => row.textContent)).toEqual([
      expect.stringContaining('With a prompt'),
      expect.stringContaining('With a file')
    ])
  })

  it('a /remember save is under Saved, and a recalled item is not', async () => {
    await openMemoryPage(RECALLED)
    const saved = within(await screen.findByTestId('context-memory-saved'))
    expect(saved.getAllByTestId('context-memory-entry').map((row) => row.textContent)).toEqual([
      expect.stringContaining('/remember')
    ])
  })

  it('says why a session runs without recall on an older claude', async () => {
    await openMemoryPage({ ...RECALLED, recall: { mode: 'launch', reason: 'claude_too_old' } })
    expect(await screen.findByTestId('context-memory-recall-off')).toHaveTextContent(
      'Update claude to 2.1.323 or newer for memory recall in this session.'
    )
  })

  it('the recall notice is an info Callout, not a warning or an error', async () => {
    await openMemoryPage({ ...RECALLED, recall: { mode: 'launch', reason: 'claude_too_old' } })
    expect(await screen.findByTestId('context-memory-recall-off')).toHaveAttribute(
      'data-callout-tone',
      'info'
    )
  })

  it('with no index but recalled items, lists the items and does not say nothing was injected', async () => {
    await openMemoryPage({ ...RECALLED, injected: null })
    const injected = within(await screen.findByTestId('context-memory-injected-section'))
    expect({
      rows: injected.getAllByTestId('context-memory-entry').map((row) => row.textContent),
      nothing: injected.queryByText('Nothing injected.'),
      summary: injected.queryByTestId('context-memory-injected')
    }).toEqual({
      rows: [expect.stringContaining('With a prompt'), expect.stringContaining('With a file')],
      nothing: null,
      summary: null
    })
  })

  it('with no index and nothing recalled, says nothing was injected', async () => {
    await openMemoryPage({ ...RECALLED, injected: null, entries: [] })
    expect(await screen.findByTestId('context-memory-injected-section')).toHaveTextContent(
      /^InjectedNothing injected\.$/
    )
  })

  it('says why a session runs without recall when the mod was not set up', async () => {
    await openMemoryPage({ ...RECALLED, recall: { mode: 'launch', reason: 'mod_not_installed' } })
    expect(await screen.findByTestId('context-memory-recall-off')).toHaveTextContent(
      'The app could not set up its Claude mod. Reopen the app to try again.'
    )
  })

  it('says nothing when the operator turned recall off', async () => {
    await openMemoryPage({ ...RECALLED, recall: { mode: 'launch', reason: 'setting_off' } })
    await screen.findByTestId('context-memory-injected-section')
    expect(screen.queryByTestId('context-memory-recall-off')).not.toBeInTheDocument()
  })

  it('says nothing when recall is on', async () => {
    await openMemoryPage(RECALLED)
    await screen.findByTestId('context-memory-injected-section')
    expect(screen.queryByTestId('context-memory-recall-off')).not.toBeInTheDocument()
  })

  it('says nothing when no recall mode was recorded (memory off, or memory failed at launch)', async () => {
    await openMemoryPage({ ...RECALLED, recall: null })
    await screen.findByTestId('context-memory-injected-section')
    expect(screen.queryByTestId('context-memory-recall-off')).not.toBeInTheDocument()
  })
})
