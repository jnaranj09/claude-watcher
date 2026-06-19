// Story 0.3 — the deterministic FAKE c9watch feed (AC-3).
//
// A test double for the real `c9watch list` + `c9watch watch --changes-only`
// streams, so the schema/reducer can be verified WITHOUT live claude processes.
// It is GROUNDED in the real c9watch 0.8.1 wire shape captured live 2026-06-18
// (the source of truth — trusted over the docs). [architecture.md#Testing & Test
// Seams ("emits canned NDJSON — snapshot + deltas + one malformed line");
// epics.md#Story 0.3 AC-3; live `c9watch list` capture 2026-06-18]
//
// Faithful to reality:
//   - `list` is a WRAPPER object `{ diagnostics, sessions: [...] }` (NOT a bare array).
//   - `watch` lines are NDJSON: one `{ event, session, sessionId, timestamp }` per line.
//   - timestamps are ISO-8601 with a tz OFFSET (the schema fails closed on tz-less),
//     in BOTH the nanosecond (9-digit) AND millisecond (3-digit) fractional-second
//     precisions c9watch 0.8.1 emits live (Story 0.5 added the ms-precision coverage).
//   - `pendingToolInput` is POLYMORPHIC: an OBJECT for `Agent`, a STRING for `Question`.
//   - one session carries the undocumented `customTitle` field (Story 0.5 live
//     finding) — it has NO schema declaration and survives via `.passthrough()`.
//   - statuses are MIXED across sessions (Working / WaitingForInput / NeedsAttention /
//     NeedsPermission) so column/attention logic (Epic 1/2) has real material.
//   - exactly ONE malformed line, interleaved BETWEEN two good lines (fail-closed test).
//
// SCHEMA-VERSIONED from day one: `C9WATCH_FIXTURE_VERSION` makes a future c9watch
// drift a one-line bump, not a hunt. [epics.md#Verified Facts; 0-2 Dev Notes]

/**
 * The c9watch wire version this fixture mirrors. Bump when the live shape drifts.
 * [Source: epics.md#Verified Facts ("Schema-version the fake-feed fixture from day one")]
 */
export const C9WATCH_FIXTURE_VERSION = '0.8.1' as const

/**
 * The `list` snapshot — the WRAPPER object c9watch emits, NOT a bare array.
 *
 * The `diagnostics` counts are illustrative/synthetic ONLY (live they tracked
 * 113 then 120 across two captures this session) — tests MUST NOT assert against
 * a specific count. The session set mirrors a HANDFUL of top-level sessions (not
 * the 113 raw processes — c9watch already filters sub-agents).
 * [Source: live capture 2026-06-18; epics.md#Verified Facts]
 */
export const fakeListSnapshot = {
  // synthetic + clearly representative; NOT assertable.
  diagnostics: { claudeProcessesFound: 4, fdaLikelyNeeded: false, processesWithCwd: 4 },
  sessions: [
    {
      // STRING pendingToolInput variant — a `Question` session waiting on the human.
      firstPrompt: 'Refactor the auth middleware to use the new token format.',
      id: '11111111-1111-4111-8111-111111111111',
      latestMessage: 'Which file holds the token validation logic?',
      messageCount: 42,
      modified: '2026-06-18T23:39:12.977979605+00:00',
      pendingToolInput: 'Which file should I edit — auth.ts or token.ts?',
      pendingToolName: 'Question',
      pid: 847001,
      projectPath: '/home/u/projects/auth-service',
      sessionName: 'auth-service',
      status: 'WaitingForInput'
    },
    {
      // OBJECT pendingToolInput variant — an `Agent` session (the live-captured shape).
      firstPrompt: 'Implement story 0.3 via the bmad dev-story workflow.',
      id: '47c6a173-9fe0-4f73-a8fc-0421af3fea24',
      latestMessage: 'Executing Agent...',
      messageCount: 134,
      modified: '2026-06-18T23:52:26.526388598+00:00',
      pendingToolInput: {
        description: 'Implement story 0.3 via bmad dev-story',
        prompt: 'Run the BMad dev-story workflow to completion.',
        subagent_type: 'general-purpose'
      },
      pendingToolName: 'Agent',
      pid: 847708,
      projectPath: '/home/u/projects/c9watch-webapp',
      sessionName: 'webapp',
      status: 'NeedsAttention'
    },
    {
      // No pending tool — a session actively Working (compact-ish shape).
      // MILLISECOND-precision `modified` (Story 0.5: live c9watch emits BOTH ns AND
      // ms ISO+tz timestamps; this is the ms variant — 3 fractional digits).
      // `customTitle` is the undocumented live field — NO schema declaration; it
      // rides through `.passthrough()` (Story 0.5 reconciliation finding).
      customTitle: 'epic0',
      firstPrompt: 'Add a dark-mode toggle to the settings page.',
      id: '22222222-2222-4222-8222-222222222222',
      latestMessage: 'Editing settings.tsx...',
      messageCount: 18,
      modified: '2026-06-18T23:55:01.100+00:00',
      pid: 847333,
      projectPath: '/home/u/projects/dashboard',
      sessionName: 'dashboard',
      status: 'Working'
    },
    {
      // STRING pendingToolInput + the help-listed NeedsPermission status.
      firstPrompt: 'Run the deploy script against staging.',
      id: '33333333-3333-4333-8333-333333333333',
      latestMessage: 'Requesting permission to run a Bash command.',
      messageCount: 7,
      modified: '2026-06-18T23:56:44.250000000+00:00',
      pendingToolInput: 'Allow running: ./deploy.sh staging',
      pendingToolName: 'Bash',
      pid: 847990,
      projectPath: '/home/u/projects/infra',
      sessionName: 'infra',
      status: 'NeedsPermission'
    }
  ]
} as const

/**
 * The `watch --changes-only` NDJSON stream as an array of RAW LINES (strings) —
 * exactly what a reader receives byte-for-byte, one JSON object per line.
 *
 * Layout (CRITICAL for the fail-closed test): the malformed line sits BETWEEN two
 * good lines, so the test proves one bad line does not poison the good ones.
 *
 *   [0] good   — `changed` on the dashboard session (now NeedsAttention).
 *   [1] BAD    — non-JSON garbage (a partial/corrupt line c9watch could emit on a
 *                flushed-mid-write pipe). Must be DROPPED + logged-by-path.
 *   [2] good   — `started` for a brand-new session (object pendingToolInput).
 *   [3] good   — `stopped` for the auth session (it answered + exited).
 *
 * Each good line carries an ISO-8601 timestamp WITH a tz offset (tz-less would be
 * correctly rejected by the schema). [Source: architecture.md#Testing & Test Seams;
 * src/shared/schemas/session.ts (IsoToEpochMillis fails closed on tz-less)]
 */
export const fakeWatchLines: readonly string[] = [
  // [0] good — the dashboard session crossed into NeedsAttention.
  // MILLISECOND-precision `modified` + `timestamp` (Story 0.5: the ms variant of the
  // dual-precision ISO+tz timestamps c9watch 0.8.1 emits live — both must validate).
  JSON.stringify({
    event: 'changed',
    session: {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'NeedsAttention',
      projectPath: '/home/u/projects/dashboard',
      pid: 847333,
      sessionName: 'dashboard',
      latestMessage: 'Finished the dark-mode toggle — review?',
      messageCount: 21,
      modified: '2026-06-18T23:57:10.134+00:00'
    },
    sessionId: '22222222-2222-4222-8222-222222222222',
    timestamp: '2026-06-18T23:57:10.134+00:00'
  }),
  // [1] BAD — corrupt/truncated NDJSON line. NOT valid JSON → dropped + logged.
  '{"event":"changed","session":{"id":"44444444-4444-4444', // truncated garbage
  // [2] good — a NEW session started, with an OBJECT pendingToolInput (Agent).
  JSON.stringify({
    event: 'started',
    session: {
      id: '55555555-5555-4555-8555-555555555555',
      status: 'Working',
      projectPath: '/home/u/projects/api',
      pid: 848100,
      sessionName: 'api',
      firstPrompt: 'Generate the OpenAPI spec from the route handlers.',
      latestMessage: 'Spawning a sub-agent to scan the routes...',
      messageCount: 3,
      modified: '2026-06-18T23:58:02.000000000+00:00',
      pendingToolName: 'Agent',
      pendingToolInput: {
        description: 'Scan route handlers',
        prompt: 'Enumerate every Express route and its method.',
        subagent_type: 'general-purpose'
      }
    },
    sessionId: '55555555-5555-4555-8555-555555555555',
    timestamp: '2026-06-18T23:58:02.000000000+00:00'
  }),
  // [3] good — the auth session answered and stopped.
  JSON.stringify({
    event: 'stopped',
    session: {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'Working',
      projectPath: '/home/u/projects/auth-service',
      pid: 847001,
      sessionName: 'auth-service',
      latestMessage: 'Done — edited token.ts.',
      messageCount: 44,
      modified: '2026-06-18T23:58:30.000000000+00:00'
    },
    sessionId: '11111111-1111-4111-8111-111111111111',
    timestamp: '2026-06-18T23:58:30.000000000+00:00'
  })
] as const

/** Index of the single malformed line in `fakeWatchLines` (for test assertions). */
export const MALFORMED_LINE_INDEX = 1

/** Count of well-formed (parseable + schema-valid) lines in `fakeWatchLines`. */
export const VALID_WATCH_LINE_COUNT = fakeWatchLines.length - 1
