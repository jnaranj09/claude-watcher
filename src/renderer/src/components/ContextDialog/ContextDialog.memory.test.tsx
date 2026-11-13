// Context's Memory page, recall while a session runs (memory phase 3): the activity comes from the
// test bridge. jsdom `unit` project; the older Memory page tests stay in `ContextDialog.test.tsx`.
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
