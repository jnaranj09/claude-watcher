// What each live session loaded, as its bridge mod last reported it (spec 2026-10-18 §2). Main
// keeps the latest report per session in memory only: it dies with the session (`forget`) and
// follows a `/clear` rebind (`rebind`). A report for an id no board shows is dropped (never
// synthesize truth); the hook server answers it 409 so the mod tries again. Never logs a value — the
// report's paths name the operator's folders.
import type { ModReport } from '../../shared/schemas/modReport'
import type { ModSkipReason, SessionSetupState } from '../../shared/schemas/contextIpc'

export interface SessionSetup {
  /** Keep the report when its session is known; false (and one `code=`) when it is not. */
  accept(report: ModReport): boolean
  /** The spawn went without the mod; a later report still wins. */
  markUnavailable(sessionId: string, reason: ModSkipReason): void
  get(sessionId: string): SessionSetupState
  /** Some live session's report names this path: the one gate restore writes through. */
  reportsPath(path: string): boolean
  rebind(oldId: string, newId: string): void
  forget(sessionId: string): void
}

export function createSessionSetup(deps: {
  /** A session some window's board shows now (index.ts `isSessionLive`). */
  isKnown: (sessionId: string) => boolean
  /** Fires once per accepted report (Context's push, the file history). */
  onChange: (sessionId: string, report: ModReport) => void
  log: (line: string) => void
}): SessionSetup {
  const states = new Map<string, Exclude<SessionSetupState, { state: 'waiting' }>>()

  return {
    accept(report) {
      if (!deps.isKnown(report.sessionId)) {
        deps.log('[claude-watcher][mods] code=mod_unknown_session')
        return false
      }
      states.set(report.sessionId, { state: 'ready', report })
      deps.onChange(report.sessionId, report)
      return true
    },
    markUnavailable(sessionId, reason) {
      if (states.get(sessionId)?.state === 'ready') return
      states.set(sessionId, { state: 'unavailable', reason })
    },
    get(sessionId) {
      return states.get(sessionId) ?? { state: 'waiting' }
    },
    reportsPath(path) {
      for (const s of states.values()) {
        if (s.state === 'ready' && s.report.instructionFiles.some((f) => f.path === path))
          return true
      }
      return false
    },
    rebind(oldId, newId) {
      const s = states.get(oldId)
      if (s === undefined) return
      states.delete(oldId)
      states.set(newId, s)
    },
    forget(sessionId) {
      states.delete(sessionId)
    }
  }
}
