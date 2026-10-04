// The single-modal rule (UX-DR14), in ONE place: App's openers, the notification click
// (openFromNotification.ts) and the Toaster (a toast's action is not rendered while a modal is
// open) ask the same question. The pure `*In(state)` forms feed `useBoard` subscriptions; the
// `is*()` forms read the store once, for event handlers.
import { boardStore, type BoardState } from '../stores/boardStore'

/** The name prompt and the Manage/Settings/Sessions dialogs — the modals the page-body
 *  Escape closes all at once (the Delete confirm and the Quit guard each have their own Escape). */
export function dialogOpenIn(s: BoardState): boolean {
  return (
    s.sessionNamePrompt !== null ||
    s.sessionsDialog !== null ||
    s.shortcutsDialogOpen ||
    s.workspacesDialogOpen ||
    s.tagsDialog !== null ||
    s.settingsDialogOpen
  )
}

/** UX-DR14 single-modal rule: no two modals ever co-exist — the dialogs above, the Delete confirm
 *  and the Quit guard (R9: those two were outside the rule, so Ctrl+N opened the picker over
 *  either). */
export function modalOpenIn(s: BoardState): boolean {
  return dialogOpenIn(s) || s.stopConfirm !== null || s.quitGuard !== null
}

export function isDialogOpen(): boolean {
  return dialogOpenIn(boardStore.getState())
}

/** A MODULE-LEVEL function (not a component-body const) so the `[]`-deps useCallbacks that call
 *  it stay free of exhaustive-deps warnings. */
export function isModalOpen(): boolean {
  return modalOpenIn(boardStore.getState())
}
