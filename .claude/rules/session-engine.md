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
  - 'src/main/memory/**'
  - 'src/main/mcp/**'
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
  `claude_version` (a toast over the name prompt; Past sessions Open and dead-pane Resume map it
  too). Caches only the OK verdict. **Fails OPEN** on unreadable version (a false block bricks a
  working install). Bump the floor only after re-verifying the three flags. API create: 503
  `claude_version`, refusal reused 30 s (`createClaudeVersionGate`).
- **Bridge mod (spec 2026-10-18):** `composeClaudeCommand` adds `--plugin-dir <userData>/mods/
watcher-bridge` right after `--settings` (new and `--resume`), and the env gets
  `CLAUDE_WATCHER_MOD_URL=http://127.0.0.1:<hookPort>/mod/report`, only when `bridgeModSpawn`
  allows it: hook port bound, install at start worked, claude ≥ `MIN_MOD_CLAUDE_VERSION` (2.1.304,
  probed; its own floor, so `MIN_CLAUDE_VERSION` does not move; unknown version → no mod,
  `code=mod_skipped_version`). A skip is fail open and marks the session `unavailable`
  (`sessionSetup.markUnavailable`). The report follows `/clear` (`sessionSetup.rebind`; the mod
  sends again from `prompt.context` + `turn.complete`, since `session.start` does not refire) and
  is dropped with the session (`window/cardState.ts` moves and drops it beside the pending
  rename). Only a live session's report is kept (`isSessionLive`); a dropped one is answered 409,
  so the mod sends it again after the next turn. The mod (`src/mod/
  watcher-bridge`, not `claude-…`: a reserved prefix) reads and reports paths + counts, and after
  each prompt POSTs who sent it (`prompt.submit` `origin.kind`, never the text) to `/mod/prompt`
  (`MOD_PROMPT_PATH`, `ModPromptSchema`, `modPromptOrigin.ts`; 409 not live, handler throw → 200 +
  `code=mod_prompt_handler_error`; nothing sent when there is no origin); it never changes claude.
  Origin probed on claude 2.1.309; `prompt.submit` is present in the 2.1.307–2.1.309 binaries; 2.1.304–2.1.306 are unverified (the mod
  floor stays 2.1.304: there the origin never arrives and the `UserPromptSubmit` fallback below
  applies). Context (`ContextDialog`) shows it, `mods/fileHistory.ts` keeps file
  versions, and Restore is the one operator-started write to an operator file (technical-taste
  §5). A goal's `GOALS.md` is the other write into a project: the operator switches it on, then
  every change rewrites it, a session's `create_task` / `mark_task_done` included. Open in editor takes any absolute path, but never a program (an execute bit or a
  launcher type: `file_runnable`); History and Restore take only an absolute `.md` path
  (`isInstructionPath`). `npm run test:mod` = `claude plugin validate` + `claude plugin test` (local only).
  After a claude upgrade also run `npm run test:claude-drift` (local only): it checks that claude
  still describes an artifact watch as `hooks/backgroundTasks.ts` reads it.
- **Goals (spec 2026-10-19):** a launch from tasks carries `goalLaunch` on the durable override
  (a Reopen keeps it); every spawn calls `goalSpawnExtras` (`goals/goalLaunch.ts`) with the id it
  replaces (`lastSessionId`). The first spawn links the launch's tasks to THAT minted id; a Reopen
  carries over only the tasks still open and still linked to the replaced id (closed or unlinked
  work never comes back). The block, appended to `--append-system-prompt` after
  `QUESTION_FORMAT_PROMPT`, lists open tasks only; none left, no block. A resume with no
  `goalLaunch` rebuilds it from the links that still name the id.
  `goals:start-sessions` refuses before anything launches (`task_repeated` at the schema,
  `task_not_found`, `goal_workspace_mismatch`, `claude_version`, `launch_cancelled`,
  `folder_missing`, `goal_folder_missing`, a bad name on any group). A goal's tasks start in the
  goal's folder only (`pickLaunchFolder`); a goal with none (made before folders were required)
  refuses with `goal_folder_missing` and never opens the picker. Daily tasks: the workspace's
  folder, else the picker.
- **A goal's folder and `GOALS.md` (spec 2026-10-29):** a new goal needs a folder (`goals:save-goal`
  without an id opens main's picker first; cancel → `folder_cancelled`, nothing created); a folder
  is never cleared. `Save to GOALS.md` (`goals:set-save-to-file`; on always rewrites): the exporter
  `goals/goalsFile.ts` runs inside the goals store's `emit()`, after EVERY change and before the
  listeners, so a new store method reaches the file only if it emits. It rewrites a folder's
  `GOALS.md` only when that folder's text changed (links and `/clear` write nothing), never writes
  or removes one without its header line, never creates a folder, and at startup only checks.
  Problems (`goals_file_not_ours`, `folder_missing`, `goals_file_write_failed`) live in memory and
  ride `GoalsView.fileProblems`; one no saving goal can show goes to `StorageNotice` (`goals_file`). `goals:link-task` (the session's task rail and the
  Goals sheet's `Link session`) refuses with `session_not_found` unless the session is live on
  the calling window's board in the task's workspace. A task linked after launch is not told to
  claude (no prompt block, no tool change): it only shows in the rail, and `mark_task_done` can
  close it only if that session already has the tool.
- **`mark_task_done` over MCP (goals):** served on the hook listener at `GOALS_MCP_PATH`
  (`/mcp/goals`; no third listener), Streamable HTTP, stateless, POST only (GET 405), behind the
  same Origin 403 and body cap plus a per-launch bearer token: a miss is 401 before the body is
  read. The line in the block, `--mcp-config <file>` and `--allowedTools` (the one tool
  `mcp__claude-watcher__mark_task_done`) come together or not at all: the operator's choice
  (`goalLaunch.markDone`; on a resume, `tokens.markDoneFor` from this run, else the past-session
  flag `tasksMarkDone`, written by the archive AND by the live crash-recovery record
  (`livePastSessions` asks `couldMarkDone`) from `tokens.markDoneFor` before the token is
  dropped), AND the hook port is ours (SEC-6, else
  `code=mcp_hook_port_not_ours`; a failed bind already shows `ServerHealthBanner`), AND the config
  file was written (a refused write reports the `goals` store's `write_failed` to storage health,
  so `StorageNotice` shows it). Tokens (`goals/mcp/goalTokens.ts` on `mcp/sessionTokens.ts`) are memory only, sha256 +
  `timingSafeEqual`, one per session, fresh on every spawn; the file
  (`<userData>/mcp/<random>.json`, folder 0700, file 0600) holds the token in `headers`, so argv
  holds only its path. The token is resolved again when the body ends (a revoke meanwhile: 401).
  `/clear` moves the task links, the token and the file (`window/cardState.ts`); a removed card
  revokes the token and deletes the file (links stay); a start (not SMOKE: it shares the default
  userData) deletes files a previous run left. Authority is the task's CURRENT `sessionIds`
  holding the caller, in the grant's workspace (`task_not_linked`, `task_not_found`; already done = ok).
  Logs: `route=mcp method=<served method|other> code=` only. Probed on claude 2.1.304 (a stub
  server, then the real app in the drive profile): it POSTs `server/discover` first (answered
  -32601; it falls back), then `initialize` with protocolVersion `2025-11-25`,
  `notifications/initialized` (202), a GET (405), `tools/list`, `tools/call`; every request carries
  the `headers` bearer and no `Origin`. The tool needs permission (`-p --permission-mode default`
  denies it without `--allowedTools`); with the flag, an interactive session in manual mode calls
  it with no prompt. Re-probe after an upgrade if the tool stops showing.
- **Planner ("Plan with Claude", goals):** `goals:plan` (`startPlanner`, `goals/goalLaunch.ts`)
  launches one session on a goal (named after it, in the goal's folder, the API launch seam),
  refused before anything launches with `goal_not_found`, `hooks_unavailable` (hook port not ours:
  the tools live on it), `claude_version`, `goal_folder_missing`, `folder_missing`. Every spawn of a
  planner (`goalLaunch.kind: 'planner'`) gets `buildPlannerPrompt`, a `mode: 'planner'` token bound
  to its goal, the config file and `--allowedTools` for its three tools (comma-joined), all four or
  none (no MCP, goal gone, SEC-6, refused write). It is linked to no task, gets no
  `mark_task_done`, and its card shows nothing new. Tools (`goals/mcp/mcpTools.ts`), no goal-id
  argument: `list_tasks` (its goal; titles go to the session, never to a log), `create_task`
  (`TaskSaveSchema` title rules → `isError title_invalid`; `addTaskFromSession` keeps the task and
  reports a refused write), `propose_split` (only that goal's OPEN tasks, else `task_not_in_goal`;
  a repeated id `task_repeated`; nothing stored on a refusal). A worker calling a planner tool, or
  a planner calling `mark_task_done`, is `-32602`. The proposal (`goals/proposals.ts`) is memory
  only, one per planner (a new one replaces it), rides in the goals view, moves on `/clear` and
  goes with the card (`window/cardState.ts`). `goals:decide-proposal`: Reject clears it; Accept
  takes only proposed task ids (`task_not_found`), runs the `goals:start-sessions` schema and
  checks, launches one hidden session per row, then clears it (a refusal keeps it). A planner
  resumed (Past sessions, or the dead pane's Resume) has no goal launch and comes back without its
  tools (known limit); a dead-pane Reopen keeps it.
- **Memory (spec 2026-11-11, phase 1):** every actual spawn (new, resume, Reopen) calls
  `memorySpawnExtras` (`memory/memoryLaunch.ts`), all or nothing: with `settings.memoryEnabled`
  (read at each spawn), the hook port ours (SEC-6) and the database open, the session gets its
  own bearer token, a `--mcp-config` file for `claude-watcher-memory`, the six tools in
  `--allowedTools` (search, get, browse, save, update, mark stale: no delete, no pin), the index
  block (`memory/memoryIndex.ts`: rules of use, pinned items, the folder's specifics, capped at
  `MEMORY_LIMITS.indexChars`) and the env `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (claude's own auto
  memory off) + `CLAUDE_WATCHER_MEMORY=1` (for the operator's own hooks). `pty/spawnExtras.ts`
  joins it with goals: one `--append-system-prompt` (`QUESTION_FORMAT_PROMPT`, the task block,
  then the index), one `--mcp-config` flag (goals file first), one comma-joined `--allowedTools`.
  A launch never fails for memory: any throw leaves no token or file, logs
  `code=memory_launch_failed`, and the session starts as if memory were off (auto memory
  included). A Reopen drops the replaced id's memory token and file first, even with memory off.
  Served at `MEMORY_MCP_PATH` (`/mcp/memory`) on the hook listener by the shared
  `mcp/mcpEndpoint.ts`, behind the same guards as `/mcp/goals`; a POST to any other `/mcp/` path
  is 404. Memory tokens are their own store (`mcp/sessionTokens.ts`): neither server's bearer
  opens the other's path. Its config files share `<userData>/mcp/`, and the goals start sweep
  clears both. A tool sees the calling LIVE session's workspace plus global items (no tool takes
  a workspace id; an item outside answers `memory_not_found`); a save is `inferred`, origin
  `agent` + that session; an update appends a version, never overwrites. An item's basis is its
  current text's: an edit takes it from the writer (agent or extract → `inferred`, operator →
  `stated`), each version keeps its own (`version.basis`), so a restore brings it back, and a
  state or pin change keeps it. Memory off, no store or
  session not live → `Memory is not available.` (logged as `code=memory_not_available`: an error
  outcome may carry a log `code`, which the endpoint logs instead of its text). `/clear` moves
  the token, the file, the activity record (kept in RAM; Context's `Memory` page reads it through
  `memory:activity`, with or without the mod's report) and the origin of the items the session
  saved (`window/cardState.ts`; the items last, guarded: `code=memory_rebind_failed`); a removed
  card drops token, file and activity, never the items. A
  deleted session (Past sessions `Forget`, or a card's `Delete`) keeps its items, marked
  `Session deleted` (`pastSessions.ts` `onRemove` → `markSessionDeletedInMemory`); a workspace
  delete's cascade deletes them. Memory text (key, value, title, body, check, reason, query)
  never reaches a log, a notification, the API or an attention event (logs carry `code=` only).
  SMOKE opens no database (memory is off); its memory check writes into a temporary folder, never
  userData.
- **Missing folder refused before anything registers** (UX-11): `launchService.launch` takes a
  required `isDirectory`, throws `folder_missing` (in-app: a toast over the name prompt "That folder
  no longer exists."; API: 409 before the 503s). Dead-pane Reopen not checked. Hook server unbound → API 503
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
- **Status rules:** a `Stop` with one of its last three non-empty lines starting `Needs you:` (`NEEDS_YOU_MARKER`,
  `endsWithNeedsYou`; `QUESTION_FORMAT_PROMPT` asks claude for it) → `NeedsAttention` and opens a
  sticky ask (`opensAsk`); else a line (of the last three) ending `?`/`？`/`؟` or an English ask phrase
  (`endsWithQuestion`) → `NeedsAttention`, not sticky; else `background_tasks` still running →
  `Working` (an artifact watch is not work: `hooks/backgroundTasks.ts`); else `YourTurn`. Every
  `Stop` carries its running task ids (`taskIds`, `runningTaskIds`). The
  reducer holds a sticky ask's `NeedsAttention` over `Working`/`YourTurn`; `NeedsPermission` still
  wins and the card returns to `NeedsAttention` after it. A seen (`markSeen`, the operator viewing
  the session) releases the hold but keeps the status, so claude's next turn decides again: a
  false or stale `Needs you:` costs one look. A sticky ask clears when a later `Stop`
  lists a task id the ask's `Stop` did not have (claude went back to work by itself, so something
  else unblocked it: a finished task or a foreground tool never clears it), on an operator prompt
  (`promptOrigin` `composer`/`bridge`, `OPERATOR_ORIGINS`; a `UserPromptSubmit` (`fromPrompt`)
  counts only while the session's mod has reported no origin: fail open, because a
  Monitor/background wake-up sends an identical `UserPromptSubmit` and the mod's origin is
  `task-notification`; the hook always reaches the app before the mod's report), on Esc or `/clear`
  (`WaitingForInput`), an AskUserQuestion closed by its own `PostToolUse`, an `answered`
  `ElicitationResult`, or removal. Esc demotes any card not already idle (and so clears a sticky
  ask); running work is never idle, so an interrupt (`interrupt`) whose last `Stop` had running
  task ids is `Working` (owner, 2026-10-26; reverses R5). Ctrl+C demotes only a `Working` card (ST-4: an early cancel sends no hook and no marker;
  idle prompt: not an interrupt; a card already in a needs-you status, such as a sticky ask or
  claude's dialog: not counted, unprobed), so it never clears a sticky ask —
  `interruptDemotes`. Tool events never pull a card out of `NeedsPermission` (R20) — except
  the `PostToolUse`/`PostToolUseFailure` whose `tool_use_id` opened the last open prompt (ST-1: a
  click or shift+tab answer sends nothing else). `PermissionRequest` has no `tool_use_id`: it opens
  the prompt for the same `agent_id`'s last `PreToolUse`, only if the tool names match;
  `PreToolUse(AskUserQuestion)` opens its own. Any non-tool status but `NeedsPermission` closes every
  open prompt (a denied one sends no tool event). Enter/`1`/`2` in that terminal → `Working` (R4,
  `code=permission_answered_key`), except while an AskUserQuestion prompt is open (ST-2: Enter may
  answer question 1 only; its PostToolUse is the way out; one with no `tool_use_id` keeps R4). `pendingToolName` and `pendingToolDetail` set only while waiting (R14); the detail is one line
  from `hooks/toolDetail.ts`, follows the name, and shows on the card and on the OS notification's second body line
  (owner, 2026-10-19; never on the API or Past sessions). A `PermissionRequest` takes the detail of its own
  `agent_id`'s last `PreToolUse` (same tool only); the `Notification` that follows a card already in
  `NeedsPermission` keeps the call it shows, never a parallel agent's later one.
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
