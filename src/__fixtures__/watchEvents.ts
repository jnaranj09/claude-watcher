// `session.updated` delta builders for tests, at the two stages of the watch pipeline:
//   - `reducerUpdated` — what the reducer emits, before enrichment (main side);
//   - `watchUpdated`   — the enriched, validated wire shape main ships to the renderer.
// Each test states only the fields it is about; the rest are fixed defaults. Fresh object per call.
import type {
  Column,
  ReducerWatchEventsPayload,
  SessionUpdatedEvent,
  WatchEventsPayload
} from '../shared/ipc/contract'

/** A bare reducer `session.updated` (no column, pid, workspace or tags yet). */
export function reducerUpdated(
  id: string,
  over: Partial<{ epoch: number; sessionName: string; projectPath: string; status: string }> = {}
): ReducerWatchEventsPayload {
  return {
    epoch: over.epoch ?? 0,
    event: {
      type: 'session.updated',
      id,
      sessionName: over.sessionName ?? 'n',
      projectPath: over.projectPath ?? '/p',
      status: over.status ?? 'Working'
    }
  }
}

/** An enriched `session.updated` in the 'default' workspace, untagged. The status follows the
 *  column (needs-you → NeedsAttention, else Working) unless `over` sets it. */
export function watchUpdated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number,
  over: Partial<SessionUpdatedEvent> = {}
): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: `s-${id}`,
      projectPath: `/p/${id}`,
      status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
      column,
      enteredColumnAt,
      pid: 1000,
      workspaceId: 'default',
      tagIds: [],
      ...over
    }
  }
}
