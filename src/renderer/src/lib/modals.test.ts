// The single-modal rule in ONE place: the Sessions dialog counts as a dialog, whatever its page.
import { describe, it, expect, afterEach } from 'vitest'
import { boardStore } from '../stores/boardStore'
import { dialogOpenIn, isModalOpen } from './modals'

afterEach(() => boardStore.getState().closeSessionsDialog())

describe('modals — the Sessions dialog', () => {
  it('counts as an open dialog on every page, and not once closed', () => {
    for (const page of ['past', 'templates'] as const) {
      boardStore.getState().openSessionsDialog(page)
      expect(dialogOpenIn(boardStore.getState())).toBe(true)
      expect(isModalOpen()).toBe(true)
    }
    boardStore.getState().closeSessionsDialog()
    expect(dialogOpenIn(boardStore.getState())).toBe(false)
  })
})
