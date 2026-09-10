// Story 1.4 — VALIDATE-AT-SOURCE enrichment of a reducer delta before it crosses the
// main→renderer seam (.claude/rules/zod-boundaries.md: main→renderer = validate at
// source). Extracted from index.ts so it is unit-testable in the `main-unit` (node)
// project WITHOUT pulling in electron/node-pty.
//
//   - `session.updated` → enrich with the tracker's `column`/`enteredColumnAt` (the
//     tracker has ALREADY processed this delta — see the ordering note at the call
//     site in index.ts) PLUS the native `pid`/`pendingToolName` read from the reducer's
//     already-parsed `Session` map (parse-once; NOT re-validated). The enriched member
//     is then asserted with `EnrichedSessionUpdatedSchema`. On a failure (e.g. the
//     tracker has no column for this id) it FAILS CLOSED: log by PATH + CODE only and
//     return `null` so the half-formed delta is NEVER shipped.
//   - `session.removed` / `attention.raised` → returned UNCHANGED (no enrichment; the
//     frozen members are not widened).
//
// never-log-the-parsed-value: only the Zod issue path + code are logged — never the
// delta/value (which carries sessionName/projectPath/pendingToolName).
import { EnrichedSessionUpdatedSchema } from '../../shared/schemas/watchDelta'
import type {
  ReducerWatchEventsPayload,
  SessionUpdatedEvent,
  WatchEventsPayload
} from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'
import type { AttentionTracker } from './attention'

/** A boundary failure record — PATH + CODE only, NEVER the value. */
export interface EnrichErrorRecord {
  path: string
  code: string
}

export function enrichDelta(
  delta: ReducerWatchEventsPayload,
  tracker: Pick<AttentionTracker, 'columnOf' | 'enteredColumnAt'>,
  sessionsById: ReadonlyMap<string, Session>,
  log: (err: EnrichErrorRecord) => void = (err) =>
    console.warn(`[c9watch][feed] dropped delta path=${err.path} code=${err.code}`)
): WatchEventsPayload | null {
  const { event, epoch } = delta
  // session.removed / attention.raised pass through unchanged (the frozen members are
  // not widened); only session.updated is enriched.
  if (event.type !== 'session.updated') return { epoch, event }

  const column = tracker.columnOf(event.id)
  const enteredColumnAt = tracker.enteredColumnAt(event.id)
  const session = sessionsById.get(event.id)
  // Build the candidate enriched member. Optional pendingToolName is spread so the
  // exactOptionalPropertyTypes slot is never assigned `string | undefined`. A missing
  // column / enteredColumnAt (tracker had no entry for this id) or a missing session
  // (no pid) fails the schema below at that field — the half-formed delta is dropped.
  const candidate: Record<string, unknown> = {
    type: 'session.updated',
    id: event.id,
    sessionName: event.sessionName,
    projectPath: event.projectPath,
    status: event.status,
    column,
    enteredColumnAt,
    pid: session?.pid,
    workspaceId: session?.workspaceId,
    ...(session?.pendingToolName !== undefined ? { pendingToolName: session.pendingToolName } : {})
  }

  const result = EnrichedSessionUpdatedSchema.safeParse(candidate)
  if (!result.success) {
    const issue = result.error.issues[0]
    // PATH + CODE only — never the candidate/value (carries session content).
    log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
    return null
  }
  // Rebuild the validated member explicitly so the exactOptionalPropertyTypes
  // `pendingToolName?: string` slot is never assigned `string | undefined` (Zod's
  // inferred optional includes `| undefined`). Spread the optional only when present.
  const d = result.data
  const validated: SessionUpdatedEvent = {
    type: 'session.updated',
    id: d.id,
    sessionName: d.sessionName,
    projectPath: d.projectPath,
    status: d.status,
    column: d.column,
    enteredColumnAt: d.enteredColumnAt,
    pid: d.pid,
    workspaceId: d.workspaceId,
    ...(d.pendingToolName !== undefined ? { pendingToolName: d.pendingToolName } : {})
  }
  return { epoch, event: validated }
}
