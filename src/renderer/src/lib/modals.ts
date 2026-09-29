// The single-modal rule (UX-DR14), in ONE place: App's openers and the notification click
// (openFromNotification.ts) ask the same question. Moved out of App.tsx unchanged.
import { boardStore } from '../stores/boardStore'

/** The name prompt and the Manage/Settings/Past-sessions dialogs — the modals the page-body
 *  Escape closes all at once (the Delete confirm and the Quit guard each have their own Escape). */
export function isDialogOpen(): boolean {
  const s = boardStore.getState()
  return (
    s.sessionNamePrompt !== null ||
    s.templatesDialogOpen ||
    s.shortcutsDialogOpen ||
    s.workspacesDialogOpen ||
    s.tagsDialogOpen ||
    s.rulesDialogOpen ||
    s.settingsDialogOpen ||
    s.pastSessionsDialogOpen
  )
}

/** UX-DR14 single-modal rule: no two modals ever co-exist — the dialogs above, the Delete confirm
 *  and the Quit guard (R9: those two were outside the rule, so Ctrl+N opened the picker over
 *  either). A MODULE-LEVEL function (not a component-body const) so the `[]`-deps useCallbacks
 *  that call it stay free of exhaustive-deps warnings. */
export function isModalOpen(): boolean {
  const s = boardStore.getState()
  return isDialogOpen() || s.stopConfirm !== null || s.quitGuard !== null
}
