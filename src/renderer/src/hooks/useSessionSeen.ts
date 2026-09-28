// Deterministic-attention — the SEEN effect: while the operator is LOOKING at a session
// (focused view's active rail session, window focused) that is `YourTurn`, tell main via
// the typed `window.launch.markSeen` invoke. Main demotes ONLY YourTurn → idle (the
// reducer guard), so this can never hide a question/permission. View intent flowing
// main-ward over typed IPC — the renderer never mutates session truth locally
// [.claude/rules/state.md]. Distinct from `acknowledgedById` (renderer-only emphasis).
import { useEffect, useState } from 'react'
import { useBoard, selectRailActiveSessionId, selectViewMode } from '../stores/boardStore'
import { YOUR_TURN_STATUSES } from '../../../shared/ipc/contract'

export function useSessionSeen(): void {
  const activeId = useBoard(selectRailActiveSessionId)
  const viewMode = useBoard(selectViewMode)
  // Primitive selector — re-runs the effect when THIS session's status changes (a new Stop
  // while the operator keeps watching flips it back to YourTurn → a fresh seen fires).
  const activeStatus = useBoard((s) =>
    activeId !== null ? s.sessionsById[activeId]?.status : undefined
  )
  const [windowFocused, setWindowFocused] = useState<boolean>(() => document.hasFocus())

  useEffect(() => {
    const onFocus = (): void => setWindowFocused(true)
    const onBlur = (): void => setWindowFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    if (viewMode !== 'focused' || !windowFocused) return
    if (activeId === null || activeStatus === undefined || !YOUR_TURN_STATUSES.has(activeStatus))
      return
    // Fire-and-forget; a rejection logs a code only (never the id as "content" — it is an
    // opaque uuid, but the log stays value-free by convention).
    window.launch.markSeen(activeId).catch(() => {
      console.warn('[attention][seen] markSeen failed code=seen_invoke_rejected')
    })
  }, [viewMode, windowFocused, activeId, activeStatus])
}
