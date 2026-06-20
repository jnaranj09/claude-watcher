// Story 3.4 (FR-16) — the rail row's SHORT-NAME derivation (kept OUT of AttentionRail.tsx so the
// component file exports ONLY components — react-refresh/only-export-components, mirroring the
// LiveAnnouncer/emphasis split). Pure; no store, no IPC.
import type { BoardSession } from '../../stores/boardStore'

/** Derive a SHORT, human row name from a session. Prefer the sessionName; fall back to the last
 *  path segment of the projectPath; finally a blank guard. CSS ellipsis handles overflow. */
export function shortName(session: Pick<BoardSession, 'sessionName' | 'projectPath'>): string {
  const name = session.sessionName.trim()
  if (name.length > 0) return name
  const segments = session.projectPath.split('/').filter((s) => s.length > 0)
  const last = segments[segments.length - 1]
  return last ?? '(session)'
}
