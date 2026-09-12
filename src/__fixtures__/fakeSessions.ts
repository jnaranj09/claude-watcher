// Story 6.4 — small SESSION fixtures for the native engine's reducer/tracker/enrich
// tests.
//
// In the native engine a session is BORN via `reducer.upsertLaunched(session)` — a
// main-CONSTRUCTED `Session` (the launch-minted uuid, the picked cwd + its basename,
// the pty pid) — and transitioned by hooks. These fixtures mirror EXACTLY that
// upsertLaunched shape (the compact `Session` fields; parse-once: never re-run
// through SessionSchema). They replace the retired fakeC9watchFeed `list` snapshot
// as the shared seed material for column/attention/enrich coverage.

import type { Session } from '../shared/schemas/session'

/** Build an upsertLaunched-shaped Session (the exact shape index.ts synthesizes at
 *  spawn), with per-test overrides. Fresh object per call — never a shared mutable. */
export function launchedSession(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    status: 'Connecting',
    projectPath: '/home/u/projects/proj',
    sessionName: 'proj',
    pid: 51234,
    // Workspaces — 'default' unless a test overrides it; not the subject of most of these
    // fixtures, so a fixed constant keeps every existing call site mechanical.
    workspaceId: 'default',
    tagIds: [],
    templateId: null,
    ...over
  }
}

// Stable ids for the named fixtures below (opaque UUIDs; never keyed by pid).
export const WORKING_ID = '22222222-2222-4222-8222-222222222222'
export const NEEDS_ATTENTION_ID = '47c6a173-9fe0-4f73-a8fc-0421af3fea24'
export const NEEDS_PERMISSION_ID = '33333333-3333-4333-8333-333333333333'
export const IDLE_ID = '11111111-1111-4111-8111-111111111111'
export const CONNECTING_ID = '66666666-6666-4666-8666-666666666666'

/**
 * A representative mixed-status set (one per column flavor) for seeding a reducer
 * via `upsertLaunched`. Statuses cover the CORRECTED status→column mapping
 * (columns.ts): Working & Connecting → working; NeedsAttention & NeedsPermission →
 * needs-you; WaitingForInput → idle. `pendingToolName` is present on both needs-you
 * sessions (an Agent question + a Bash permission) and absent elsewhere, so the
 * optional-field paths get real material.
 */
export function fakeLaunchedSessions(): Session[] {
  return [
    launchedSession(WORKING_ID, {
      status: 'Working',
      projectPath: '/home/u/projects/dashboard',
      sessionName: 'dashboard',
      pid: 847333
    }),
    launchedSession(NEEDS_ATTENTION_ID, {
      status: 'NeedsAttention',
      projectPath: '/home/u/projects/c9watch-webapp',
      sessionName: 'webapp',
      pid: 847708,
      pendingToolName: 'Agent'
    }),
    launchedSession(NEEDS_PERMISSION_ID, {
      status: 'NeedsPermission',
      projectPath: '/home/u/projects/infra',
      sessionName: 'infra',
      pid: 847990,
      pendingToolName: 'Bash'
    }),
    launchedSession(IDLE_ID, {
      status: 'WaitingForInput',
      projectPath: '/home/u/projects/auth-service',
      sessionName: 'auth-service',
      pid: 847001
    }),
    launchedSession(CONNECTING_ID, {
      status: 'Connecting',
      projectPath: '/home/u/projects/payments',
      sessionName: 'payments',
      pid: 848220
    })
  ]
}
