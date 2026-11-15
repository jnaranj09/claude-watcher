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
    injected: { tokens: 120, itemIds: ['m1'], groups: [] },
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

// Spec 2026-11-14 memory context index §9: under `Injected`, after the `Index:` line, one row per
// group the section listed or counted, in main's order: how many items, how many claude read with
// `memory_get`, how many the group's count line named.
describe('ContextDialog — the Memory page, why keys were listed', () => {
  const GROUPED: MemoryActivity = {
    injected: {
      tokens: 300,
      itemIds: ['m1', 'm2', 'm3'],
      groups: [
        { reason: 'task', itemIds: ['m1', 'm2'], more: 0 },
        { reason: 'folder', itemIds: ['m3'], more: 12 }
      ]
    },
    recall: { mode: 'mod' },
    entries: [
      { at: NOW - 50_000, action: 'pulled', tool: 'memory_get', itemId: 'm2', reason: null },
      { at: NOW - 40_000, action: 'pulled', tool: 'memory_get', itemId: 'm2', reason: null },
      { at: NOW - 30_000, action: 'pulled', tool: 'memory_search', itemId: null, reason: null }
    ]
  }

  async function openMemoryPage(activity: MemoryActivity): Promise<void> {
    stubMemory(activity)
    await openContext()
    await userEvent.click(screen.getByTestId('context-category-memory'))
  }

  it('lists one row per reason under the index line, in the order main gave', async () => {
    await openMemoryPage(GROUPED)
    const rows = await screen.findAllByTestId('context-memory-reason')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Same task.*2 items.*1 pulled$/),
      expect.stringMatching(/^This folder.*1 item.*12 not listed$/)
    ])
    const section = within(screen.getByTestId('context-memory-injected-section'))
    expect(section.getAllByTestId('context-memory-reason')).toHaveLength(2)
  })

  it('an item pulled twice counts once; a search counts for no reason', async () => {
    await openMemoryPage(GROUPED)
    const rows = await screen.findAllByTestId('context-memory-reason')
    expect(rows.map((r) => r.textContent)).not.toContainEqual(expect.stringContaining('2 pulled'))
    expect(rows[1]).not.toHaveTextContent('pulled')
  })

  it('only memory_get counts as read: another tool that names an item does not', async () => {
    await openMemoryPage({
      ...GROUPED,
      entries: [
        { at: NOW - 30_000, action: 'pulled', tool: 'memory_search', itemId: 'm3', reason: null },
        { at: NOW - 20_000, action: 'pulled', tool: 'memory_browse', itemId: 'm1', reason: null }
      ]
    })
    const rows = await screen.findAllByTestId('context-memory-reason')
    expect(rows.map((r) => r.textContent)).not.toContainEqual(expect.stringContaining('pulled'))
  })

  it('no groups, no reason rows', async () => {
    await openMemoryPage({
      ...GROUPED,
      injected: { tokens: 300, itemIds: ['m1'], groups: [] }
    })
    expect(await screen.findByTestId('context-memory-injected')).toHaveTextContent(
      /^Index: 300 tokens · 1 item$/
    )
    expect(screen.queryAllByTestId('context-memory-reason')).toHaveLength(0)
  })
})
