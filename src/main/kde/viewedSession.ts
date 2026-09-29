// Is the operator looking at this session right now? (UX-13 in docs/reports/2026-09-23-bug-hunt)
//
// A popup and a sound fired for the session the operator was already typing in. The alert
// sources (the first raise in index.ts's handleDelta and the reminder sink) skip a session when
// ALL of these hold:
//   - the app window has the OS focus;
//   - the renderer shows the focused view, on a terminal (`CH.viewFocusedTerminal`);
//   - that terminal is bound to this session RIGHT NOW (the launch service's binding, which a
//     `/clear` rebind moves and an exit clears).
// A board view, a minimized or unfocused window, or another session on screen all alert as before.
// This is not a workspace filter: alerts stay global (CLAUDE.md).
//
// Pure: no electron import, never throws.

export interface ViewedSessionDeps {
  windowFocused: () => boolean
  /** The terminal the renderer shows in its focused view, or null on the board. */
  focusedTerminalId: () => string | null
  /** The session a terminal is bound to now (`launchService.sessionIdFor`), or null. */
  sessionIdFor: (terminalId: string) => string | null
}

export function isViewingSession(sessionId: string, deps: ViewedSessionDeps): boolean {
  if (!deps.windowFocused()) return false
  const terminalId = deps.focusedTerminalId()
  if (terminalId === null) return false
  return deps.sessionIdFor(terminalId) === sessionId
}
