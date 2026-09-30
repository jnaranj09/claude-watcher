// Action feedback (spec 2026-09-29 §2.3) — moving a card to another workspace. NOT optimistic: the
// moved card arrives as a `session.updated` delta (main is session truth, state.md). The card
// leaves the board being looked at, so the toast is the only sign it worked: success names where
// it went (the workspace in its tint, design.md), a refusal says so — it used to be an unhandled
// rejection. Never rejects.
import { boardStore } from '../stores/boardStore'
import { toast } from '../stores/toastStore'
import { workspacesStore } from '../stores/workspacesStore'

export async function moveCardToWorkspace(sessionId: string, workspaceId: string): Promise<void> {
  const name = boardStore.getState().sessionsById[sessionId]?.sessionName ?? 'session'
  try {
    await window.launch.setWorkspace(sessionId, workspaceId)
  } catch {
    console.warn('[claude-watcher][workspaces] code=move_card_failed') // never the value
    toast.error(`Could not move "${name}".`)
    return
  }
  const target = workspacesStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (target === undefined) {
    toast.success(`Moved "${name}"`)
    return
  }
  toast.success(`Moved "${name}" to`, { workspace: { name: target.name, tone: target.color } })
}
