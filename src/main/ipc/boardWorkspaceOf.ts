// Session truth is per window: a renderer's request about a session is answered from the CALLING
// window's board (its launch board seam, keyed by `event.sender`). This is that lookup: the
// session's workspace while it is a live card there, else undefined (ended, unknown, or the window
// has no board). Used by `session:set-tags` and `goals:link-task`.
import type { LaunchBoardSeam } from '../window/watchFeed'

export function boardWorkspaceOf<Sender>(
  seams: ReadonlyMap<Sender, Pick<LaunchBoardSeam, 'workspaceOf'>>,
  sender: Sender
): (sessionId: string) => string | undefined {
  return (sessionId) => seams.get(sender)?.workspaceOf(sessionId)
}
