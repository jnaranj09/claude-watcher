// UX-13 — tell main which terminal the focused view shows (null on the board), so main skips the
// popup and the sound for the session the operator is typing in (`src/main/kde/viewedSession.ts`).
// Main checks the window focus and the terminal's session itself; this sends view-state only, and
// only when it changes.
import { useEffect } from 'react'
import { useBoard } from '../stores/boardStore'

export function useReportFocusedTerminal(): void {
  const terminalId = useBoard((s) => (s.viewMode === 'focused' ? s.focusedTerminalId : null))
  useEffect(() => {
    window.attention.reportFocusedTerminal(terminalId)
  }, [terminalId])
}
