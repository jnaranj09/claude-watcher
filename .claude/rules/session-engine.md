---
paths:
  - 'src/main/hooks/**'
  - 'src/main/pty/**'
  - 'src/main/c9watch/**'
  - 'src/main/lifecycle/**'
  - 'src/main/persistence/**'
  - 'src/main/kde/**'
  - 'src/main/index.ts'
  - 'src/main/ipc/**'
  - 'src/main/window/**'
  - 'src/shared/launch/**'
  - 'src/shared/schemas/hookEvent.ts'
  - 'src/shared/schemas/session.ts'
  - 'src/__fixtures__/**'
---

# Rule: the native session engine

Moved from CLAUDE.md on 2026-10-01 (context budget, technical-taste §5b-19); unchanged. Main owns
session truth (`state.md`); every input is parsed at one boundary (`zod-boundaries.md`).

- **Min claude 2.1.245, checked at launch** (`pty/claudeVersion.ts`, `MIN_CLAUDE_VERSION` in
  `src/shared/launch/`). Spawn passes `--session-id`, `-n`, `--settings`; an older claude rejects
  them and dies. `CH.sessionLaunch` probes `$SHELL -l -c "<claude> --version"`, refuses with
  `claude_version` (error line in the name prompt; Past sessions Open and dead-pane Resume map it
  too). Caches only the OK verdict. **Fails OPEN** on unreadable version (a false block bricks a
  working install). Bump the floor only after re-verifying the three flags. API create: 503
  `claude_version`, refusal reused 30 s (`createClaudeVersionGate`).
- **Missing folder refused before anything registers** (UX-11): `launchService.launch` takes a
  required `isDirectory`, throws `folder_missing` (in-app: error line "That folder no longer
  exists."; API: 409 before the 503s). Dead-pane Reopen not checked. Hook server unbound → API 503
  `hooks_unavailable` (after `claude_version`, before `no_window`).
- **Identity minted at launch:** `claude --session-id <uuid>`; card synthesized immediately via
  `reducer.upsertLaunched` (status `Connecting`). Identity = stable `id`, never `pid`.
- **Hooks own every status transition** (POST to `127.0.0.1:9279`). **Zero footprint:**
  `hookSettingsFile.ts` writes the hook block into userData; `composeClaudeCommand` passes
  `--settings <path>`. Scoped to app-launched sessions only; merges with project settings; same-URL
  stale blocks are deduped. (Replaced `registerHooks`, which wrote `.claude/settings.local.json`
  into every cwd — the app does not clean those up.) All input via `hookEvent.ts`
  (`.passthrough()`; malformed known key → 400 + drop + log path/code). `hookStatus.ts` = the only
  event→status map; `pty/approvalKey.ts` = the only keystroke→status map (R4).
- **No bind, no `--settings` (SEC-6):** `hookSettingsPathIfListening` gives the flag only while
  THIS process holds the hook port (`serverHealth.ts`). Otherwise the session runs without status
  and `ServerHealthBanner` (`CH.serverHealth`/`serverHealthGet`) says `port_in_use` /
  `server_error` / `hooks_file_failed`. Never withhold silently; never send without the bind. POST
  with an `Origin` header → 403 before body read (SEC-2; claude sends none — re-probe if cards stop
  moving after an upgrade).
- **Every exit has a reason.** Archive, Ctrl+C×2, `/exit`, pty exit, `SessionEnd`, app quit, window
  close → reason `archive`: snapshot into `claude-watcher-past-sessions.json`
  (`persistence/pastSessions.ts`, v1, cap 200, cascades on workspace delete) BEFORE the reducer
  drops it. Quit/close fire no pty onExit, so `archiveBoundSessions` (`pty/launchRemoval.ts`) runs
  first — in `teardownAllSessions` before `destroyAll`, and in `teardownWindowTerminals` before
  `teardownWatchFeed`. Never throws (`code=teardown_archive_failed`). `Delete` → reason `delete`:
  no record, earlier record dropped, using the override's `lastSessionId` (`deleteTerminalSession`;
  renderer `sessionId` is a hint). Never touches claude's files. Late `SessionEnd` is idempotent.
- **Resume:** `Past sessions` reopens with `claude --resume <id>` (`resumeSessionId`; id kept) plus
  `-n <record name>` (`resumeName`, not the frozen recipe's). Dead pane (UX-10) shows exit
  code/signal (`CH.terminalExit`); `Resume conversation` calls `CH.pastSessionResumeTerminal` with
  the terminal id only → main uses `lastSessionId` (`resumeTerminalSession`); renderer opens the
  new terminal and forgets the dead one.
- **Live records (UX-01):** `livePastSessions.ts` writes a `live` record at launch and on every
  name/folder/workspace/tags/transcript change (+ ≤1/min `endedAt` refresh). `list()` hides live
  records; cap never evicts/counts them. Hidden records have their own cap
  (`PAST_SESSIONS_HIDDEN_MAX` 200, `code=past_sessions_hidden_trimmed`); visible cap logs
  `code=past_sessions_trimmed`. `/clear` drops the old id (`dropLive`). Next start turns leftover
  live → normal (`code=past_sessions_recovered_live`) — covers crash/SIGKILL. Open does NOT remove
  the record (UX-02).
- **Open refusals:** `transcript_missing` (UX-08, `pty/claudeTranscript.ts`): path gone, or no
  `<configDir>/projects/*/<id>.jsonl`; only ENOENT/ENOTDIR count; fails open on unlistable dir or
  non-UUID. `session_running_elsewhere` (UX-14, `pty/runningElsewhere.ts`): a live pid in
  `~/.claude/sessions/<pid>.json` holds the id (`kill(pid,0)`, EPERM = alive); returns one boolean,
  fails open.
- **No conversation, no record (NEW-5):** claude writes the transcript on the first prompt, so a
  session archived before it (or stuck on folder-trust) gets no record
  (`code=past_sessions_no_transcript_skipped`); such leftover live records are dropped on load.
  The no-path scan is trusted only while hooks are bound (`archiveTranscriptCheck`). Ended records
  are never dropped for it.
- **SIGTERM can't be caught** (Electron turns it into `app.quit()`; stops at the quit guard until
  SIGKILL). Live records cover it.
- **Rename waits for the next prompt:** `Session.nameSyncPending` draws `⟳`;
  `pendingTitles.rebind` moves it on `/clear` (`adoptCard`). Rename of an unknown id queues
  nothing (R17, `hooks/renameLaunched.ts`).
- **Unknown-id hook events are no-ops** (`hook_unknown_id`): never synthesize a card; no transcript
  tail; never log the raw id (`hooks/sessionTracking.ts`, SEC-2/3). `/clear` adoption runs before
  this gate; `forgetSession` on every removal stops the tail (R13).
- **`/clear` changes the id; the card follows** (`hooks/sessionRebind.ts`). Exact proof first:
  `~/.claude/sessions/<pid>.json` (`pty/claudeSessionFile.ts`, third fail-closed boundary, never
  log — has cwd + name). Only the terminal's OWN outermost claude counts (R18) — a nested
  `claude -p` from the Bash tool is never proof; ambiguous → cwd heuristic fallback (cwd +
  single match + alive + 5-min window). Logs: `hook_sessionend_pty_alive`,
  `hook_session_id_rebound proof=pid|cwd`, `hook_rebind_window_expired`.
  **Agent view (←) parks the conversation** into a background job outside the pty: the
  terminal's record gets `parkedJobId`, the job's record (`kind:"bg"`, `jobId`) holds the current
  id; the records source lists a parked terminal by the job's id only (spec
  2026-10-06-agent-view-parked-session). A parked terminal's `SessionEnd` marks no orphan; a
  `Notification` under a parked card's id that differs from the job's READABLE id is agent-list
  chatter (`hook_agent_view_notification_ignored`; no readable job id → kept); an orphan is never
  claimed while its terminal is parked; a `Notification` never adopts through the cwd fallback
  (`cwdFallbackMayAdopt`: after the re-key the list's chatter carries the old, now unknown id).
  Quitting does not stop the job (claude's native behaviour); park → quit unused → Resume opens a
  copy (known limit).
- **`status` is not enum-locked.** `pendingToolInput` is polymorphic (object for `Agent`, string
  otherwise) — don't narrow.
- **Status rules:** turn ending with `background_tasks` running = `Working` (until next event; Esc
  demotes any card not already idle). Ctrl+C demotes only a `Working` card (ST-4: an early cancel
  sends no hook and no marker; idle prompt: not an interrupt; needs-you: not counted, unprobed) —
  `interruptDemotes`. Tool events never pull a card out of `NeedsPermission` (R20) — except
  the `PostToolUse`/`PostToolUseFailure` whose `tool_use_id` opened the last open prompt (ST-1: a
  click or shift+tab answer sends nothing else). `PermissionRequest` has no `tool_use_id`: it opens
  the prompt for the same `agent_id`'s last `PreToolUse`, only if the tool names match;
  `PreToolUse(AskUserQuestion)` opens its own. Any non-tool status but `NeedsPermission` closes every
  open prompt (a denied one sends no tool event). Enter/`1`/`2` in that terminal → `Working` (R4,
  `code=permission_answered_key`), except while an AskUserQuestion prompt is open (ST-2: Enter may
  answer question 1 only; its PostToolUse is the way out; one with no `tool_use_id` keeps R4). `pendingToolName` set only while waiting (R14).
  `PermissionRequest` (dialog open, 6 s before its `Notification`) → `NeedsPermission`, except
  AskUserQuestion (ST-5). An API error ends the turn
  with `StopFailure` and no `Stop` → `YourTurn` (ST-3). A dialog waiting on the operator
  (`Notification` `permission_prompt`, `worker_permission_prompt`, `agent_needs_input`) →
  `NeedsPermission`; an MCP server asking for input (`Elicitation`, then
  `Notification(elicitation_dialog|elicitation_url_dialog)` 6 s later) → `NeedsAttention`, ended by
  `ElicitationResult` → `Working` or the MCP tool's `PostToolUse`; both elicitation sides act as tool
  events (never out of `NeedsPermission`) and get an empty 200, never an action (ST-6). A manual `/compact`
  sends only `PreCompact`/`PostCompact` (`trigger:"manual"`) → `Working` / `YourTurn`; `auto`
  (mid-turn) is ignored, so it never touches an open prompt; a failed compact sends no
  `PostCompact` (ST-8). `!` bash mode sends nothing: known limit, no heuristic. claude refuses http hooks for `SessionStart`/`Setup`, so neither is registered:
  `/clear` is seen as `SessionEnd reason:"clear"` on a live pty → `WaitingForInput` under the old
  id, then adoption (ST-7, `clearedSessionStatus`); a fresh spawn stays `Connecting` until its
  first prompt.
  Hook body cap 8 MiB (R22).
