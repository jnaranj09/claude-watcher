// A click on an attention notification opens that session (R29 in
// docs/reports/2026-09-23-bug-hunt). It used to only SELECT the card, so a session in another
// workspace, or a click while focused on a different terminal, showed nothing at all. Main has
// already raised the window (UX-12, `src/main/kde/notificationActivate.ts`).
//
// The same path as an explicit switch + a card click: switch to the session's workspace (main
// owns the pointer, and only a CONFIRMED switch re-points the focused view — WorkspaceSwitcher's
// rule), then `activateCard`, which selects, acknowledges and opens the session's own terminal
// (or stays on the board when the card has no terminal yet). A card that already left is a no-op.
import { boardStore } from '../stores/boardStore'
import { setActiveWorkspace, workspacesStore } from '../stores/workspacesStore'

export async function openFromNotification(id: string): Promise<void> {
  const session = boardStore.getState().sessionsById[id]
  if (session === undefined) return
  const workspaceId = session.workspaceId
  if (workspacesStore.getState().activeId !== workspaceId) {
    await setActiveWorkspace(workspaceId)
    // `setActiveWorkspace` swallows an IPC failure: only the value main confirmed counts.
    if (workspacesStore.getState().activeId !== workspaceId) return
    boardStore.getState().focusWorkspace(workspaceId)
  }
  boardStore.getState().activateCard(id)
}
