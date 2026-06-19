// Story 0.2 — the single typed IPC contract for the main <-> renderer seam.
//
// This is the ONE source of truth for channel names AND their payload shapes.
// Main, preload, AND renderer import from here; no channel may appear as a
// string literal at a call site (enforced by the authored `no-literal-channels`
// ESLint rule). [Source: architecture.md#Layer 1; #Canonical Recipes; AC-1]
//
// Conventions (architecture.md#Naming Patterns / #Format Patterns):
//   - Channels are lowercase `domain:action` strings.
//   - Payload types are PascalCase, NO `I` prefix, camelCase fields.
//   - `invoke` returns the value directly — NO `{ data, error }` wrapper.
//   - Events are discriminated unions on a `type` field.

/**
 * The canonical channel registry. A single `as const` object so every channel
 * name lives in exactly one place and is referenced as `CH.xxx` everywhere.
 *
 * The first group are the channels the Story-0.1 smoke wires LIVE on disk — they
 * must be in the contract so AC-1 ("no channel is a string literal at a call
 * site") holds against the real codebase, not just future code.
 *
 * The second group are the architecture's named-but-not-yet-wired channels.
 * They document the seam and bind in later epics; defining them now keeps the
 * contract the single registry. [Source: architecture.md#Naming Patterns]
 */
export const CH = {
  // --- Live today (Story 0.1 PTY/smoke spike) ---
  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  smokeConfig: 'smoke:config',
  smokeReport: 'smoke:report',

  // --- Named in the architecture, wired in later epics ---
  sessionLaunch: 'session:launch',
  sessionStop: 'session:stop',
  watchSnapshot: 'watch:snapshot',
  watchEvents: 'watch:events',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const

/** The union of every valid channel name. [Source: architecture.md#Canonical Recipes] */
export type Channel = (typeof CH)[keyof typeof CH]

// ---------------------------------------------------------------------------
// Payload types (PascalCase, no `I` prefix, camelCase fields).
// `invoke` returns the value directly — no envelope wrapper. [Format Patterns]
// ---------------------------------------------------------------------------

/** `pty:resize` request — renderer-computed terminal dimensions. */
export type PtyResizeRequest = {
  cols: number
  rows: number
}

/** `pty:input` request — raw keystroke bytes from the terminal. */
export type PtyInputRequest = string

/** `pty:data` event — raw PTY output bytes streamed to the renderer. */
export type PtyDataEvent = string

/** `pty:exit` event — the PTY process exited. */
export type PtyExitEvent = {
  exitCode: number
}

/**
 * `smoke:config` invoke return — whether smoke mode is on, plus the main-process
 * ABI versions the packaged smoke records. (Story 0.1 AC-3 harness.)
 */
export type SmokeConfig = {
  enabled: boolean
  electron: string
  abi: string
  node: string
}

/**
 * `smoke:report` request — the renderer's smoke verdict. Kept structurally open
 * (the smoke harness assembles an ad-hoc checks object) but typed as a record so
 * the channel is contract-covered. (Story 0.1 AC-3 harness.)
 */
export type SmokeReport = Record<string, unknown>

// ---------------------------------------------------------------------------
// AttentionEvent — the FROZEN discriminated union (AC-1).
//
// "Frozen" = a stable, named contract type (NOT a runtime Object.freeze) that
// downstream epics may rely on without it shifting under them. Epic-2's
// attention engine is the consumer; we freeze the shape now, before any consumer
// exists, so the contract is stable.
//
// Discriminated on `type`, mirroring the architecture's event union shape
// (`session.updated | session.removed | attention.raised`). The attention model
// (PRD FR-5/FR-9): a Card transitions into Needs-you or into Done/Idle; the
// session is identified by its stable `id` (plus human-facing `sessionName` /
// `projectPath`); attention is alert-only.
// [Source: epics.md#Story 0.2 AC; #Epic 0 scope; architecture.md#Format Patterns]
// ---------------------------------------------------------------------------

/** A session was updated (state/fields changed) — board should re-render it. */
export type SessionUpdatedEvent = {
  type: 'session.updated'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
  /** New status string from c9watch (not enum-locked). */
  status: string
}

/** A session disappeared (process gone / watch `stopped`) — remove its card. */
export type SessionRemovedEvent = {
  type: 'session.removed'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
}

/** A session crossed into a state that needs the human's attention (alert-only). */
export type AttentionRaisedEvent = {
  type: 'attention.raised'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
  /** The status that triggered the alert (e.g. WaitingForInput). */
  status: string
  /** The pending tool awaiting the human, when c9watch reports one. */
  pendingToolName?: string
  /** Event time in epoch millis (coerced from the c9watch ISO-8601 timestamp). */
  timestamp: number
}

/**
 * The frozen attention/session event union. Consumers discriminate on `type`.
 * [Source: architecture.md#Format Patterns ("events = discriminated unions on a
 * `type` field"); epics.md#Epic 0 scope ("the frozen `AttentionEvent` type")]
 */
export type AttentionEvent = SessionUpdatedEvent | SessionRemovedEvent | AttentionRaisedEvent
