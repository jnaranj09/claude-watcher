// The single-modal rule in ONE place: the paged dialogs count as a dialog, whatever their page.
import { describe, it, expect, afterEach } from 'vitest'
import { boardStore } from '../stores/boardStore'
import { dialogOpenIn, isModalOpen } from './modals'

afterEach(() => {
  boardStore.getState().closeSessionsDialog()
  boardStore.getState().closeTagsDialog()
})

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

describe('modals — the Tags dialog', () => {
  it('the Tags dialog counts on both pages', () => {
    for (const page of ['tags', 'rules'] as const) {
      boardStore.getState().openTagsDialog(page)
      expect(dialogOpenIn(boardStore.getState())).toBe(true)
    }
    boardStore.getState().closeTagsDialog()
    expect(dialogOpenIn(boardStore.getState())).toBe(false)
  })
})
