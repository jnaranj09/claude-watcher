// The SESSION REDUCER (main process only) — the authoritative `Map<id, Session>`.
//
// Story 6.4 (native session engine): the c9watch CLI is RETIRED. This module no longer
// parses NDJSON watch lines or `list` snapshots — sessions are born at SPAWN TIME
// (`upsertLaunched`, the Story-6.2 launch-minted `--session-id` identity) and every later
// status transition or removal is HOOK-driven (`applyHookStatus`, fed by the :9279 hook
// ingest) or stop/exit-driven (the Story-6.3 fast removal, which rides the same removed
// path). The directory name `c9watch/` is historical.
//
// The reducer remains the session source of truth (.claude/rules/state.md: "Session
// truth = the MAIN process") and still produces the typed, epoch-framed session deltas
// (frozen `session.updated`/`session.removed`) the renderer consumes. With no snapshot
// reconcile the epoch never advances (a constant 0) — the framing stays purely for the
// renderer's stale-discard contract. Determinism: `now()` is injected; nothing reads
// the wall clock. [Source: spec-native-session-engine.md Story 6.4;
// .claude/rules/{zod-boundaries,state,ipc}.md]
import type { Session } from '../../shared/schemas/session'
import { YOUR_TURN_STATUSES } from '../../shared/ipc/contract'
import { sameTagSet } from '../../shared/tags/tagScope'
import type {
  ReducerSessionUpdatedEvent,
  SessionRemovedEvent,
  ReducerWatchEventsPayload
} from '../../shared/ipc/contract'

/**
 * The discriminated union of hook-driven status changes. Exported so `hookStatus.ts`
 * can import the input contract without the reducer importing the hooks layer.
 * (consistent-type-imports: import type only — the reducer must NOT be a runtime
 * dependency of the hooks layer.)
 */
export type HookStatusChange =
  | {
      kind: 'status'
      status: string
      /** `PreToolUse` only: the tool claude is about to run. The reducer remembers the last one,
       *  because the `Notification(permission_prompt)` that follows does not name it (R14). */
      toolName?: string
      /** A `PreToolUse` / `PostToolUse` status, or an MCP server's input form opening or being
       *  answered from inside its tool call (ST-6). It never pulls a card OUT of `NeedsPermission`:
       *  a parallel subagent's tool events would otherwise clear a prompt that is still open
       *  (R20). The approval keystroke (`approvedLaunched`), a prompt, a Stop or an interrupt
       *  still do. */
      fromTool?: true
      /** The tool call this event belongs to (`tool_use_id`: PreToolUse, PostToolUse,
       *  PostToolUseFailure). Opaque. */
      toolUseId?: string
      /** The subagent that sent it (`agent_id`); absent = the main agent. Opaque. */
      agentId?: string
      /** PostToolUse / PostToolUseFailure: the tool call is over. When it is the call that opened
       *  the last open prompt, it DOES pull the card out of `NeedsPermission`: a prompt answered by
       *  click or shift+tab sends no key the app can read, only this (ST-1). */
      toolDone?: true
      /** PermissionRequest / PreToolUse(AskUserQuestion): a prompt for a tool call just opened.
       *  With no `toolUseId` (PermissionRequest carries none) it is the same agent's last
       *  PreToolUse, and only when the tool names match. */
      opensPrompt?: true
      /** The approval keystroke (R4, `pty/approvalKey.ts`). Ignored while an AskUserQuestion
       *  prompt is open: Enter may answer only its first question, and its own PostToolUse is the
       *  way out (ST-2). */
      fromKey?: true
    }
  | { kind: 'removed' }

/** A boundary failure record — PATH + CODE only, NEVER the parsed/raw value.
 *  (A ZodError stringifies its INPUT, which can carry PTY content / prompts /
 *  secrets. .claude/rules/zod-boundaries.md#Never-log-the-parsed-value.) */
export interface BoundaryErrorRecord {
  /** Where the failure happened (Zod issue path joined by '.', or a marker). */
  path: string
  /** The issue code (e.g. 'hook_unknown_id'). */
  code: string
}

/** A single epoch-framed session delta — the BARE reducer payload (pre-enrichment).
 *  Story 1.4: the reducer produces the bare `session.updated`; main's `enrichDelta`
 *  ship stage upgrades it to the enriched renderer-facing `WatchEventsPayload`. */
export type SessionDelta = ReducerWatchEventsPayload

/** Options for the reducer factory. `now()` is injected for determinism. */
export interface ReducerOptions {
  /** Epoch-millis clock — inject for deterministic tests; defaults to Date.now. */
  now?: () => number
  /** Boundary-error sink — receives PATH + CODE only. Defaults to a console log. */
  log?: (err: BoundaryErrorRecord) => void
}

/** The public reducer surface consumed by main/index.ts and tests. */
export interface Reducer {
  /**
   * Apply a hook-driven status change (or session removal) for a known session `id`.
   * Returns the deltas produced (a single `session.updated` or `session.removed`).
   *
   * IMPORTANT: unknown `id` + `kind: 'status'` → returns `[]` + logs
   * `{ path: '(hook)', code: 'hook_unknown_id' }`. Hook signals are authority over STATUS
   * for an already-known (app-launched) session only; they must NOT synthesize a card for
   * an unknown session — external sessions stay off the board (Story 3.3 ship gate; the
   * native engine has NO external discovery by design).
   *
   * Unknown `id` + `kind: 'removed'` → returns `[]` SILENTLY (no log). Story 6.3: removal is
   * idempotent — the stop/exit fast-removal path (index.ts) usually beats the belt-and-
   * suspenders SessionEnd hook here, and removing an already-gone id is the
   * "already gone" no-op, not an error (one removal, zero noise).
   */
  applyHookStatus(id: string, change: HookStatusChange): SessionDelta[]
  /**
   * Story 6.2 — synthesize/refresh an APP-LAUNCHED session at spawn time (the launch-minted
   * `--session-id` identity). The input is MAIN-INTERNAL data — main constructed it from values
   * it owns (the launch service's minted uuid, the picked cwd, the pty pid) — NOT external
   * input, so it is deliberately NOT re-run through `SessionSchema` (parse-once boundary:
   * construct a valid `Session` at the call site; re-validation is unsupported by design).
   *
   * UPSERT semantics (deliberate): an unknown `id` INSERTS; an EXISTING `id` is a NORMAL
   * update — never a throw (a Reopen re-spawn under the same frame is a refresh, not an
   * error). The upsert REPLACES the stored session wholesale — a fresh spawn's `Connecting`
   * is the new truth; hooks own every later transition.
   *
   * Emits ONE epoch-framed `session.updated` (the same delta shape every consumer knows)
   * for the caller to route through the SAME `handleDelta` chokepoint (tracker → enrich →
   * ship gate).
   */
  upsertLaunched(session: Session): SessionDelta[]
  /**
   * Session-naming A2 — rename an EXISTING session. Swaps `sessionName` and NOTHING else.
   *
   * Unknown `id` → returns `[]` + logs `{ path: '(rename)', code: 'rename_unknown_id' }`,
   * mirroring the `hook_unknown_id` no-op: a rename must never SYNTHESIZE a card (that would
   * put a session on the board that was never launched by this app — the Story-3.3 ship gate).
   * A rename racing a stop/exit that already removed the card is therefore a quiet no-op.
   *
   * Known `id` → emits ONE `session.updated` through the same `toUpdated`. Deliberately NOT a
   * new delta type: every consumer already reads `sessionName` off that delta, so the rename
   * needs no renderer-side plumbing beyond the existing store reducer.
   *
   * DOES NOT REORDER THE BOARD. `enteredColumnAt` is stamped by `attention.ts` only on a COLUMN
   * change, and this re-emits with an UNCHANGED status — so the sort key survives. Do not add a
   * re-stamp here; a rename is not a state transition.
   *
   * `name` arrives already validated + trimmed by `SessionNameSchema` at the IPC boundary. It is
   * OPERATOR CONTENT — never logged (the unknown-id log above carries a marker path, no value).
   *
   * Session-naming A2 — swap an existing session's `sessionName`. `nameSyncPending` marks the
   * rename as waiting for claude (an in-app rename: true; the read-back of claude's own title:
   * omitted ⇒ false). Unknown id → [] + log rename_unknown_id.
   */
  renameSession(id: string, name: string, nameSyncPending?: boolean): SessionDelta[]
  /** Name-sync — the pending push was taken by the hook server; drop the mark. [] when the
   *  session is unknown or nothing was pending (no redundant delta). */
  clearNameSyncPending(id: string): SessionDelta[]
  /**
   * Workspaces — move an EXISTING session to another workspace. Swaps `workspaceId` and
   * NOTHING else.
   *
   * Unknown `id` → `[]` + logs `{ path: '(set-workspace)', code: 'set_workspace_unknown_id' }`,
   * mirroring `rename_unknown_id`: a move must never SYNTHESIZE a card (Story-3.3 ship gate).
   * An unchanged workspace → `[]` silently (no delta for a no-op click).
   *
   * DOES NOT REORDER THE BOARD. `enteredColumnAt` is stamped by `attention.ts` only on a COLUMN
   * change, and this re-emits with an UNCHANGED status — so the sort key survives. Do not add a
   * re-stamp here; moving a card between workspaces is not a state transition.
   *
   * `tagIds` is the list the card KEEPS — spec T-9: the caller drops the old workspace's own
   * tags, so the reducer stays store-free; it lands in the same delta as the move.
   */
  setWorkspace(id: string, workspaceId: string, tagIds: readonly string[]): SessionDelta[]
  /**
   * Tags — replace an EXISTING session's tags. Swaps `tagIds` and NOTHING else (spec §2.5).
   *
   * Unknown `id` → `[]` + logs `{ path: '(set-tags)', code: 'set_tags_unknown_id' }`: a tag write
   * must never SYNTHESIZE a card (Story-3.3 ship gate). An UNCHANGED set (order-insensitive) →
   * `[]` silently, so a no-op click ships no delta.
   *
   * DOES NOT REORDER THE BOARD: the status is unchanged, so the tracker does not re-stamp
   * `enteredColumnAt`, and no column-change or time rule can see this delta as an edge (T-3).
   */
  setTags(id: string, tagIds: readonly string[]): SessionDelta[]
  /**
   * Deterministic-attention — the operator VIEWED this session (active rail tab in a
   * focused window). Demotes ONLY `YourTurn` → `WaitingForInput` (idle); ANY other
   * status — a question, a permission wait, active work, already idle, or an unknown
   * id — is a SILENT no-op. That guard is the race safety: a `seen` that arrives after
   * a newer Stop/question/permission can never hide it. Unknown-id logs nothing
   * (viewing is not an error, and a seen racing a removal is normal).
   */
  markSeen(id: string): SessionDelta[]
  /** A defensive COPY of the current authoritative map. */
  snapshotMap(): Map<string, Session>
  /** Current session count. */
  size(): number
  /** The current epoch (a constant 0 in the native engine — kept for the delta-framing
   *  contract the renderer's stale-discard relies on). */
  epoch(): number
  /** Epoch-millis stamp of the last applied delta (null before any apply). */
  lastAppliedAt(): number | null
}

/** Default boundary-error sink — logs PATH + CODE only (never the value). */
function defaultLog(err: BoundaryErrorRecord): void {
  console.warn(`[c9watch][reducer] dropped path=${err.path} code=${err.code}`)
}

/** Build a `session.updated` delta from a Session (validate-at-source: the data is
 *  main-owned/already-validated, so we shape it to the frozen union — NOT a re-parse). */
function toUpdated(session: Session): ReducerSessionUpdatedEvent {
  return {
    type: 'session.updated',
    id: session.id,
    sessionName: session.sessionName,
    projectPath: session.projectPath,
    status: session.status
  }
}

/** Build a `session.removed` delta. Uses the LAST-KNOWN session for the human-
 *  facing fields when available; falls back to the id with empty human fields if
 *  the session was never in the map. */
function toRemoved(id: string, known: Session | undefined): SessionRemovedEvent {
  return {
    type: 'session.removed',
    id,
    sessionName: known?.sessionName ?? '',
    projectPath: known?.projectPath ?? ''
  }
}

export function createReducer(options: ReducerOptions = {}): Reducer {
  const now = options.now ?? Date.now
  const log = options.log ?? defaultLog

  const map = new Map<string, Session>()
  // The tool of each session's last PreToolUse — what a following permission prompt is for.
  const lastToolName = new Map<string, string>()
  // ST-1 — per session: each agent's last PreToolUse (key: `agent_id`, '' = the main agent), and
  // the tool calls whose prompt is open (id → tool name). A prompt closes when its own tool call
  // finishes.
  const lastPreTool = new Map<string, Map<string, { toolUseId: string; toolName?: string }>>()
  const openPrompts = new Map<string, Map<string, string | undefined>>()
  // The epoch is a CONSTANT 0 in the native engine (no snapshot reconcile ever bumps
  // it). Kept in the frame so the renderer's `payload.epoch < state.epoch` stale-drop
  // contract is untouched (0 < 0 is false → every delta applies).
  const currentEpoch = 0
  let lastApplied: number | null = null

  function frame(event: ReducerSessionUpdatedEvent | SessionRemovedEvent): SessionDelta {
    return { epoch: currentEpoch, event }
  }

  /**
   * Apply a hook-driven status change for a KNOWN session.
   * Unknown id + status → return [] + log hook_unknown_id (deliberate no-upsert — see interface).
   * Unknown id + removed → return [] silently (Story 6.3 idempotent removal — see interface).
   */
  function applyHookStatus(id: string, change: HookStatusChange): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined) {
      // Story 6.3 — removing an already-gone id is the idempotent no-op (emit nothing,
      // LOG nothing): the stop/exit fast-removal usually beats the SessionEnd hook here,
      // and that late hook must be quiet, not an error.
      if (change.kind === 'removed') return []
      // Unknown id + status: no-op + log. Path = '(hook)' marks the hook boundary.
      log({ path: '(hook)', code: 'hook_unknown_id' })
      return []
    }

    if (change.kind === 'removed') {
      // SessionEnd / stop / exit: remove the session from the map and emit session.removed.
      map.delete(id)
      lastToolName.delete(id)
      lastPreTool.delete(id)
      openPrompts.delete(id)
      lastApplied = now()
      return [frame(toRemoved(id, stored))]
    }

    // kind === 'status': hooks own the status — update it, keep the other fields.
    if (change.fromKey === true && questionOpen(id)) return []
    if (change.toolName !== undefined) lastToolName.set(id, change.toolName)
    const closedLastPrompt = trackPrompts(id, change)
    if (change.fromTool === true && stored.status === 'NeedsPermission' && !closedLastPrompt) {
      return []
    }
    // `pendingToolName` names the tool the card WAITS on, so it lives only as long as the wait:
    // the last PreToolUse's tool for a permission prompt, AskUserQuestion for its own question,
    // and nothing for any other status (R14 — nothing set it before, so every permission alert
    // said "wants permission" without saying for what).
    const pendingToolName =
      change.status === 'NeedsPermission'
        ? lastToolName.get(id)
        : change.status === 'NeedsAttention' && change.fromTool === true
          ? change.toolName
          : undefined
    const updated: Session = { ...stored, status: change.status }
    if (pendingToolName === undefined) delete updated.pendingToolName
    else updated.pendingToolName = pendingToolName
    map.set(id, updated)
    lastApplied = now()
    return [frame(toUpdated(updated))]
  }

  /**
   * ST-1 — keep the open-prompt bookkeeping for one status change. Returns true only when this
   * change is a finished tool call that closed the LAST open prompt: the one tool event allowed
   * to pull a card out of `NeedsPermission`. Every other tool event keeps R20 (a parallel
   * subagent's calls have other ids).
   */
  function trackPrompts(id: string, change: HookStatusChange & { kind: 'status' }): boolean {
    const agent = change.agentId ?? ''
    const scopes =
      lastPreTool.get(id) ?? new Map<string, { toolUseId: string; toolName?: string }>()
    lastPreTool.set(id, scopes)
    const prompts = openPrompts.get(id) ?? new Map<string, string | undefined>()
    openPrompts.set(id, prompts)

    if (change.toolDone === true) {
      if (change.toolUseId === undefined) return false
      if (scopes.get(agent)?.toolUseId === change.toolUseId) scopes.delete(agent)
      return prompts.delete(change.toolUseId) && prompts.size === 0
    }
    if (change.fromTool === true && change.toolUseId !== undefined) {
      const pre: { toolUseId: string; toolName?: string } = { toolUseId: change.toolUseId }
      if (change.toolName !== undefined) pre.toolName = change.toolName
      scopes.set(agent, pre)
    }
    if (change.opensPrompt === true) {
      const last = scopes.get(agent)
      const promptId =
        change.toolUseId ??
        (last !== undefined && last.toolName === change.toolName ? last.toolUseId : undefined)
      if (promptId !== undefined) prompts.set(promptId, change.toolName)
      return false
    }
    // A prompt, a Stop, an interrupt or the approval key: every open prompt is over (a denied one
    // sends no tool event, so its id must not linger and hold a later prompt open).
    if (change.fromTool !== true && change.status !== 'NeedsPermission') prompts.clear()
    return false
  }

  /**
   * ST-2 — is an AskUserQuestion prompt open? Then a key cannot be read as its answer (Enter on a
   * multi-question one answers question 1 only), and its own PostToolUse will close it. A question
   * opened without a `tool_use_id` is not tracked, so it keeps the key path (never stuck).
   */
  function questionOpen(id: string): boolean {
    for (const toolName of openPrompts.get(id)?.values() ?? []) {
      if (toolName === 'AskUserQuestion') return true
    }
    return false
  }

  /**
   * Story 6.2 — upsert an app-launched session (main-internal input; see the interface doc).
   * Insert-or-replace keyed on the stable `id`; a same-id re-upsert is a normal update.
   */
  function upsertLaunched(session: Session): SessionDelta[] {
    map.set(session.id, session)
    lastApplied = now()
    return [frame(toUpdated(session))]
  }

  /**
   * Session-naming A2 — swap an existing session's `sessionName` (see the interface doc).
   * Unknown id → [] + log rename_unknown_id (never synthesize a card from a rename).
   */
  function renameSession(id: string, name: string, nameSyncPending = false): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined) {
      // Path = '(rename)' marks the boundary; the NAME is operator content and never logged.
      log({ path: '(rename)', code: 'rename_unknown_id' })
      return []
    }

    // `sessionName` (+ `nameSyncPending`) ONLY. Spreading `stored` keeps status/projectPath/pid
    // untouched, which is what makes this safe to emit through `toUpdated` without disturbing the
    // column or the sort key.
    const renamed: Session = { ...stored, sessionName: name, nameSyncPending }
    map.set(id, renamed)
    lastApplied = now()
    return [frame(toUpdated(renamed))]
  }

  /** Name-sync — the pending push was taken; drop the mark (see the interface doc). */
  function clearNameSyncPending(id: string): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined || stored.nameSyncPending !== true) return []
    const cleared: Session = { ...stored, nameSyncPending: false }
    map.set(id, cleared)
    lastApplied = now()
    return [frame(toUpdated(cleared))]
  }

  /**
   * Workspaces — move an existing session to another workspace (see the interface doc).
   * Unknown id → [] + log set_workspace_unknown_id (never synthesize a card from a move).
   */
  function setWorkspace(
    id: string,
    workspaceId: string,
    tagIds: readonly string[]
  ): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined) {
      // Path marks the boundary; the workspace id is opaque but the session is not logged.
      log({ path: '(set-workspace)', code: 'set_workspace_unknown_id' })
      return []
    }
    if (stored.workspaceId === workspaceId) return []
    const moved: Session = { ...stored, workspaceId, tagIds: [...tagIds] }
    map.set(id, moved)
    lastApplied = now()
    return [frame(toUpdated(moved))]
  }

  /** Tags — swap an existing session's tags (see the interface doc). */
  function setTags(id: string, tagIds: readonly string[]): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined) {
      log({ path: '(set-tags)', code: 'set_tags_unknown_id' })
      return []
    }
    if (sameTagSet(stored.tagIds, tagIds)) return []
    const tagged: Session = { ...stored, tagIds: [...tagIds] }
    map.set(id, tagged)
    lastApplied = now()
    return [frame(toUpdated(tagged))]
  }

  /**
   * Deterministic-attention — see the interface doc. Guarded demotion: only a stored
   * `YourTurn` session moves to `WaitingForInput`; every other case (unknown id, or a
   * known id in ANY other status) is a silent no-op — no delta, no log.
   */
  function markSeen(id: string): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined || !YOUR_TURN_STATUSES.has(stored.status)) return []
    const updated: Session = { ...stored, status: 'WaitingForInput' }
    map.set(id, updated)
    lastApplied = now()
    return [frame(toUpdated(updated))]
  }

  return {
    applyHookStatus,
    upsertLaunched,
    renameSession,
    clearNameSyncPending,
    setWorkspace,
    setTags,
    markSeen,
    // A defensive copy so callers can never mutate the authoritative map.
    snapshotMap: (): Map<string, Session> => new Map(map),
    size: () => map.size,
    epoch: () => currentEpoch,
    lastAppliedAt: () => lastApplied
  }
}
