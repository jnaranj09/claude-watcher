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
  `CLAUDE_WATCHER_MOD_URL=http://127.0.0.1:<hookPort>/h/<token>/mod/report` (the session's hook
  channel token, below; the mod cuts `/mod/report` to reach `/mod/prompt`), only when
  `bridgeModSpawn` allows it: a channel token minted (hook port bound), install at start worked, claude ≥ `MIN_MOD_CLAUDE_VERSION` (2.1.304,
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
  `code=mod_prompt_handler_error`; nothing sent when there is no origin). `watcher-bridge` reads
  and reports and never changes what claude does or shows; a second mod, `watcher-memory` (spec
  2026-11-12), is the one mod that changes what claude reads, only in a session started with
  Memory and `Memory recall` on, the mod installed, and claude ≥ `MIN_MEMORY_MOD_CLAUDE_VERSION`
  (2.1.323, probed), and only four ways: one `session` section added last (the index), one
  context block beside an operator prompt, one context block after a Read / Edit / Write /
  NotebookEdit result in the main conversation, and `/remember`; it never rewrites, drops or
  denies, never breaks the prompt cache, draws nothing, registers no tool
  (`tests/main/memoryModBounds.guard.test.ts`); an unknown event name unloads a whole hooks module
  (probed 2.1.323), which is why it is a second mod.
  Origin probed on claude 2.1.309; `prompt.submit` is present in the 2.1.307–2.1.309 binaries; 2.1.304–2.1.306 are unverified (the mod
  floor stays 2.1.304: there the origin never arrives and the `UserPromptSubmit` fallback below
  applies). Context (`ContextDialog`) shows it, `mods/fileHistory.ts` keeps file
  versions (the newest 10 a file, 5 MiB and 200 files in all; past them the file seen longest ago goes), and Restore is the one operator-started write to an operator file (technical-taste
  §5). A goal's `GOALS.md` is the other write into a project: the operator switches it on, then
  every change rewrites it, a session's `create_task` / `mark_task_done` included. Open in editor takes any absolute path, but never a program (an execute bit or a
  launcher type: `file_runnable`); History and Restore take only an absolute `.md` path
  (`isInstructionPath`), and through a link only when the file it ends at is one too (opened
  no-follow, non-blocking, a regular file: `mods/contextHandlers.ts`, `mods/fileHistory.ts`). A second mod, `src/mod/watcher-memory` (memory phase 3), ships and
  installs the same way into `<userData>/mods/watcher-memory` (`mods/startMods.ts`
  `installAppMods`: each install on its own, a failed one reports `bridge_mod` and logs
  `code=mod_install_failed`, the other still installs); a spawn passes it, after the bridge mod's
  folder, only when memory's launch picks recall (the Memory bullet below). It hooks seven
  events (index section, recall per prompt, keys at use, `/remember`, window count on `/clear` and
  compaction), each call to main raced by its own timer, and talks only to
  `http://127.0.0.1:<port>/mcp/memory`'s listener (`parseConfig` refuses any other link, P3-C21).
  `tests/main/memoryModBounds.guard.test.ts` reads every file the installer ships from the mod
  folder (its `ships` rule) and bounds what it may hook and call (each hook inline, each `on(…)`
  but `command.run` ending in `.catch(…)`, `ask`'s path a `MOD_PATHS` member, one fetch); a
  shipped file that is neither scanned `.ts` nor `plugin.json` / `hooks.json` fails it, and those
  two are pinned to their exact content (no command hook, `mcpServers` or `hooks` key); it is a
  tripwire for honest mistakes, not a sandbox (P3-C25, P3-C27): review of the mod's files is the
  control.
  `src/mod/engine.d.ts` is the one ambient engine type file for both mods (not shipped).
  The bridge mod's hooks module and manifest stay byte for byte (`tests/main/bridgeModPinned.test.ts`, P3-C2).
  `npm run test:mod` = `claude plugin validate` + `claude plugin test` for both mods (local only).
  After a claude upgrade also run `npm run test:claude-drift` (local only): it checks that claude
  still describes an artifact watch as `hooks/backgroundTasks.ts` reads it.
- **Goals (spec 2026-10-19):** a launch from tasks carries `goalLaunch` on the durable override
  (a Reopen keeps it); every spawn calls `goalSpawnExtras` (`goals/goalLaunch.ts`) with the id it
  replaces (`lastSessionId`). The first spawn links the launch's tasks to THAT minted id; a Reopen
  carries over only the tasks still open and still linked to the replaced id (closed or unlinked
  work never comes back). Before that call, a Reopen (a previous id, no resume; plain, worker or
  planner) calls `carrySessionGoal(previous, new)` and a planner spawn calls
  `notePlanner(new, goalId)` (`pty/claudeSpawnCommand.ts`; the carry first), so the new id keeps
  the memory goal and the planner record; a throw logs `memory_goal_carry_failed` /
  `memory_planner_note_failed` and the spawn goes on. The block, appended to
  `--append-system-prompt` after `QUESTION_FORMAT_PROMPT`, lists open tasks only; none left, no
  block. A resume with no `goalLaunch` rebuilds it from the links that still name the id.
  `goals:start-sessions` refuses before anything launches (`task_repeated` at the schema,
  `task_not_found`, `goal_workspace_mismatch`, `claude_version`, `launch_cancelled`,
  `folder_missing`, `goal_folder_missing`, a bad name on any group). A goal's tasks start in the
  goal's folder only (`pickLaunchFolder`); a goal with none (made before folders were required,
  or a memory goal made for a session with no folder) refuses with `goal_folder_missing` and never
  opens the picker. Daily tasks: the workspace's
  folder, else the picker.
  Memory's saves add and update tasks too (`addTaskFromExtraction`, `updateTaskFromExtraction`,
  with `check`, `leftWith`, `lastSeenAt`, `originSessionId` and `folder`, none of them written to
  `GOALS.md`). A new task goes, in this order, to the goal the session plans (its planner record,
  `GoalsFile.plannerSessions`), the goal its links name (`meta.goalId`) when that goal is in the
  save's workspace, the session's own **memory goal** (a goal of that workspace whose
  `Goal.memorySessionIds` holds an id of the session; the oldest wins), else a new memory goal
  named after the session (`memory/sessionGoal.ts`) in the session's folder; a null folder makes a
  goal with no folder. A session's ids (`/clear`, Reopen) are one family through the session
  lineage (`GoalsFile.sessionLineage`), so each of them finds the same goal. A save that adds a
  task, or updates one from a sighting, records the session in `Task.touchedBy`. Once, at start
  and before memory's catch-up, a cleanup (`memory/sessionGoalStart.ts`, marker
  `GoalsFile.memoryRegroupedAt`) gives every memory task its session's touch and moves each
  session's open, unlinked memory tasks from Daily tasks into its memory goal; it first copies the
  goals file to `claude-watcher-goals.pre-regroup-<ts>.json` (the live file stays). Codes:
  `goals_memory_regroup` (counts), `goals_memory_regroup_failed`,
  `goals_memory_regroup_backup_failed` (the cleanup waits for the next start). Memory never
  links a task to a session. A session's `task_report` sets `report` (`reportTask`), a flag the
  Goals sheet shows. Neither ever closes a task: `Done` stays the operator's (or a linked
  session's `mark_task_done`).
- **A goal's folder and `GOALS.md` (spec 2026-10-29):** a goal the operator creates needs a folder
  (`goals:save-goal` without an id opens main's picker first; cancel → `folder_cancelled`, nothing
  created); a memory goal takes its session's folder, or none; a folder is never cleared.
  `Save to GOALS.md` (`goals:set-save-to-file`; on always rewrites): the exporter `goals/goalsFile.ts` runs
  inside the goals store's `emit()`, after every change to goals or tasks (a write of only the
  session lineage or the planner records does not emit) and before the listeners, so a new store
  method reaches the file only if it emits. It rewrites a folder's
  `GOALS.md` only when that folder's text changed (links and `/clear` write nothing), never writes
  or removes one without its header line (a `GOALS.md` that is a link or not a regular file counts as
  not ours), writes through a random temp name it creates new (never a link that is there), never
  creates a folder, and at startup only checks.
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
  `/clear` moves the task links, a task's `originSessionId`, its report's `sessionId` and its
  `touchedBy`, adds the new id to every goal whose `memorySessionIds` holds the old one, and
  records the lineage (`GoalsStore.rebindSession`; a throw in those memory-goal steps logs
  `[claude-watcher][goals] code=goals_rebind_lineage_failed` and keeps the moves), and moves the
  token and the file (`window/cardState.ts`); a removed card
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
  none (no MCP, goal gone, SEC-6, refused write). The prompt lists the goal's tasks, then the
  sessions that worked on them (`Task.touchedBy`, `shared/goals/goalSessionOrder.ts` order, names
  from `goals/sessionNameOf.ts`, cleaned by `promptSafeName`); `buildPlannerPrompt` alone caps it
  (20 sessions, 20 ids each) and keeps both lists within `PLANNER_LIST_BUDGET_BYTES` measured after
  `shellQuote` (done tasks dropped first, then a `more tasks` line; session lines are dropped
  before task lines); the spawn's `taskIds` are only the listed tasks. It is linked to no task,
  gets no `mark_task_done`, and its card shows nothing new. Tools (`goals/mcp/mcpTools.ts`), no
  goal-id argument: `list_tasks` (its goal; titles go to the session, never to a log), `create_task`
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
- **Memory (spec 2026-11-11 and its phase 2 addendum):** every actual spawn (new, resume,
  Reopen) calls `memorySpawnExtras` (`memory/memoryLaunch.ts`), all or nothing: with `settings.memoryEnabled`
  (read at each spawn), the hook port ours (SEC-6) and the database open, the session gets its
  own bearer token, a `--mcp-config` file for `claude-watcher-memory`, the seven tools in
  `--allowedTools` (search, get (one id, or up to 10 ids in one call,
  `MEMORY_LIMITS.getIds`; a miss among several ids is a line of the result), browse, save, update, mark stale,
  `task_report`: no delete, no
  pin, no task closed; `task_report` only flags a task of the session's workspace, else
  `task_not_found`), the index block (`memory/memoryIndex.ts`: rules of use; pinned items newest
  first, which may pass the cap but never `MEMORY_LIMITS.indexCeilingChars` (the block rides one
  argv string; the rest are counted, `<n> more pinned`); then, capped at
  `MEMORY_LIMITS.indexChars`, the folder's open tasks (minus the ones the goal block lists,
  `GoalSpawnExtras.taskIds`), the active specifics and facts in eight groups, each item under the
  first reason it shares with the session (`KEY_REASONS`: task, goal, folder, folders above,
  whole workspace = no folder, goal or tags, template, tags, folders below; `contextItems`), each
  with a heading that says why and a count line for its rest, and its recent sessions (by the day
  the session ended): groups get 6 lines each, then recent sessions, then all groups but template
  and tags take more; tasks left out are counted in `<n> more open tasks …; see Goals`, the rest
  in `<n> more; use memory_search`. A key's line (`memory/memoryKeyLine.ts`, at use too): its
  value whole up to 24 characters, else cut with its length, or `value not shown` (a secret
  pattern in the value, a `<private>` tag, or a key that names a secret: `password`, `passwd` or
  `secret` anywhere, or `token`, `pwd`, `api`/`access`/`private` + `key` as a word part
  (`namesSecret`); a short secret under any other key is printed); a fact its title and length; `check`
  and `session deleted` marks; the id's first 8 characters (whole on a clash). A launch without
  the mod has no template or tags group. Every saved text on one line,
  `memory/promptText.ts`, with a system-reminder tag and the memory block marker neutralised (P3-C1); a tool result prints a fact or episode body last, each line indented) and
  the env `CLAUDE_WATCHER_MEMORY=1` (for the operator's own hooks). Once the config file is
  written, one choice per spawn (`mods/memoryModSpawn.ts` `createMemoryModChoice`, read live:
  `settings.memoryRecallEnabled`, then the installed `watcher-memory` folder still there, then
  claude ≥ `MIN_MEMORY_MOD_CLAUDE_VERSION` 2.1.323, its own floor; unknown version →
  `code=memory_mod_skipped_version`) picks recall or phase 1. Recall: NO index block (the mod
  sends it as a section), `--plugin-dir <userData>/mods/watcher-memory` after the bridge mod's
  folder, env `CLAUDE_WATCHER_MEMORY_CONFIG=<the session's memory --mcp-config file>`
  (`MEMORY_CONFIG_ENV`; the mod reads the link and the token there, so the token never reaches the
  env or argv), and `recall.launched`. Phase 1: the index block as above, no mod, no config var.
  Either way the activity record keeps the mode (`mod`, or `launch` + `setting_off` /
  `mod_not_installed` / `claude_too_old`) for Context; a session with no memory keeps none. A
  session without recall composes the same command as before phase 3. The setting is a choice
  made at spawn: a change applies to sessions started after it (P3-C19); `Memory` off reaches a
  running mod at its next request. A `/clear` rebind moves the token and keeps the file, so the
  mod process (whose env still names that file) calls as the new id; a resume or a Reopen is a
  new spawn (a new token and file, the replaced ones dropped first). `pty/spawnExtras.ts`
  joins it with goals: one `--append-system-prompt` (`QUESTION_FORMAT_PROMPT`, the task block,
  then the index), one `--mcp-config` flag (goals file first), one comma-joined `--allowedTools`,
  the mod folders (bridge first, then memory); it also asks memory for the launch's workspace
  (main's active one when it names none) and builds the child env (memory's vars only while
  memory is on). The launch path composes it all in `pty/claudeSpawnCommand.ts`.
  `recall.launched` keeps the goal block's task ids, so the section the mod asks for later leaves
  them out too.
  Recall (`memory/memoryRecall.ts`, `modMemoryWiring.ts`): four POST routes at `MOD_MEMORY_PATHS`
  (`/mod/memory/index`, `recall`, `at-use`, `remember`) on the hook listener behind the memory
  bearer (P3-C20: only the memory server's own tokens open them); no body names a session (the
  grant does); an unknown `/mod/memory/` path is 404. Every request carries the mod's `window`,
  counted up at each `/clear` and compaction of the main conversation; a request whose window
  differs from the one main keeps (a late one from an older window too, P3-C16) resets what main
  remembers the session was told (the index's ids, the ids given since, at most 500, and the
  characters given). The mod races each call: 500 ms (index), 250 ms (recall), 250 ms (at use),
  3,000 ms (`/remember`); a miss or a failed call pauses every call but `/remember` and a window's one index ask (below)
  for 30 s.
  An index ask main ANSWERS with a no (Memory off, the gate) clears the mod's index; only a failed
  ask keeps the last good one (P3-C22). So a window that began while Memory was off keeps no
  section and no folder keys after Memory is back on: they come back at the next window (the next
  `/clear` or compaction); per-prompt recall works at once. Off and on inside one window leaves
  its section as it was. The mod asks for the index once per window, at the window's first request, and that ask
  ignores the pause; whatever comes back (the index, a no, or a failure that keeps the last good
  index of an earlier window, else none) holds until the next window (P3-C28). Budgets: at most
  3 items and 2,000 characters a prompt (each line ≤ 600), at use at most 5 folders a call, 10
  keys and 1,500 characters, and 20,000 characters of recall and at-use
  blocks a window, never passed (a block that would pass it is not given, and its items stay
  ungiven: M13); an item is given once per window, and recall skips a key the window's section
  showed whole while its text is unchanged. Before recall's items, each operator prompt (the same
  origin test, whatever its words) can get the "saved or changed" block
  (`Memory (Claude Watcher): saved or changed since this conversation started`, at most
  5 key lines (`MEMORY_LIMITS.freshRows`), inside the same 2,000 and 20,000 characters, recall's
  lines left out first): keys the session's selection (`contextRows`) lists that changed after
  the window's section was built and were not given with that change, and, when its tasks, goal,
  template or tags changed, keys of those reasons the window was not told; a workspace move adds
  `This session moved to another workspace. …` and lists the new context. A window remembers
  since when and for which workspace and context it was told its keys (`built`: set when the
  section is built, then moved to the prompt by a selection that told everything it found or
  found nothing to tell) and the change each key was given with by any block (`told`, ruling
  C7); never a key this same session saved or updated last (its activity record, newest 200
  entries). A prompt costs one count
  (`changedSince` since `built.at`); the selection runs once per change in scope or in the
  context, then the count again (ruling C6); no model call. A resumed window (no `built`) and a
  session without the mod get none of it. Matching cuts the prompt's first 2,000
  characters, its `<private>` spans left out, into 12 terms (`recallTerms.ts`); each term keeps its 200 newest rows (P3-C12); an
  item needs 2 terms or 1 exact one. The prompt text is used for the match and dropped. claude
  fixes a `session` section per conversation window, and a resumed conversation keeps its
  recorded one (probed 2.1.323, and again on 2.1.325 through the app). So a resume
  (`request.resume` → `recall.launched`) gets recall per prompt and at use at once, but its
  index only after the next `/compact` or `/clear`: in the window it resumed into, main answers
  the index ask yet records no ids and no `Index:` line, and at use withholds nothing for it
  (P3-C28); a `/clear` rebind drops the resume (a new conversation). A block is appended after
  the cached prefix and does not invalidate the prompt cache (probed). `/remember` (no model
  turn; Windows line ends accepted,
  P3-C14) saves one `stated` operator item and refuses a non-operator origin, an empty or too
  long text, a control character and a secret (`hasSecret`) or a `<private>` tag (`holdsPrivate`,
  answered as a secret). Every saved text a model reads goes
  through `wrapperSafe` (P3-C1: a `system-reminder` tag and the memory block marker are
  neutralised; on the joined text and on each composed line, P3-C15).
  claude's own auto memory is a separate setting (`settings.claudeAutoMemory`, owner 2026-11-12:
  the two memories work side by side), read at every spawn whether memory is on or not: `off` →
  env `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `on` → `=0` (forces it on over the operator's
  `autoMemoryEnabled: false`), `claude` (default) → the app sets nothing, so claude's settings
  decide (all three probed on claude 2.1.322).
  A launch never fails for memory: any throw (the mod's config or the launch index included,
  P3-C24) leaves no token or file, logs `code=memory_launch_failed`, and the session starts as if
  memory were off, with no recall mode recorded. A Reopen drops the
  replaced id's memory token and file first, even with memory off.
  Served at `MEMORY_MCP_PATH` (`/mcp/memory`) on the hook listener by the shared
  `mcp/mcpEndpoint.ts`, behind the same guards as `/mcp/goals`; a POST to any other `/mcp/` path
  is 404. Memory tokens are their own store (`mcp/sessionTokens.ts`): neither server's bearer
  opens the other's path. Its config files share `<userData>/mcp/`, and the goals start sweep
  clears both. A tool sees the calling LIVE session's workspace plus global items (no tool takes
  a workspace id; an item outside answers `memory_not_found`; an id of 8 or more characters that
  is no whole id is taken as an id's start inside that scope, and two matches answer
  `memory_id_ambiguous`); a save is `inferred`, origin
  `agent` + that session; an update appends a version, never overwrites. An item's context
  (`folder`, and `goalId` / `tagIds` in its meta) is stamped from its session when it is saved;
  only the operator changes it afterwards, in the Memory dialog's form (`memory:create` /
  `memory:edit` with a `context`, `MemoryStore.setContext`: no version, no date change; a goal or
  tag new to the item must exist and fit its scope, else `memory_context_invalid`). No tool, save
  or session writes it; a re-placed item reaches a running conversation at its next window. An item's basis is its
  current text's: an edit takes it from the evidence extraction gives with it (and keeps where
  that text came from, `source_*`), else from the writer (agent or extract → `inferred`, operator
  → `stated`, the source cleared); each version keeps its own (`version.basis`), so a restore
  brings it back, and a state or pin change keeps it. An episode is never pinned. Memory off, no store or
  session not live → `Memory is not available.` (logged as `code=memory_not_available`: the endpoint
  logs an error outcome's `code` and never a result's text, which can echo model input such as
  `memory_get`'s ids; an outcome with no code logs `code=tool_error`; a `memory_get` whose ids
  all missed logs their one code, or `memory_ids_not_read` for a mix). `/clear` moves
  the token, the file, the activity record (kept in RAM, ids and counts only, the section's
  `groups` included; Context's `Memory` page reads it through
  `memory:activity`, with or without the mod's report, and lists again on `memory:changed`, which
  a store change and an activity change both push: `memoryStartup.ts`) and the origin of the items the session
  saved, the commands it ran and its save state (`window/cardState.ts`; the items last, guarded:
  `code=memory_rebind_failed`); a removed card drops token, file and activity, never the items.
  Saving from sessions (`memory/extract/`, built by `appExtractor.ts`, wired in
  `extractWiring.ts`): the hooks add save points, never a status transition
  (`window/memorySavePoints.ts`: `routeHookEnd`, `runRemoval`). Checkpoint: a launched session's
  Nth `Stop` since its last save point (`settings.memoryCheckpoint`, 0 = never), counted after its
  status is shipped. End: once per card exit (archive, a pty exit after `/exit` included) and once
  per `/clear`, each while the card still holds the id: the kept `SessionEnd` calls `ended(old)`
  BEFORE the rebind moves the card (R34; a rebind that finds the old row still owed, with no job
  of the old id queued or running, keeps it owed for the next start and logs
  `memory_extract_end_missing`). An end needs a finished turn (`Stop`, or `StopFailure` through
  `stopFailed`, either while Memory was on) since launch or resume, or since that id's last end
  (`rebind` does not carry it): with none it makes no job, no row and no record, not even `off`
  (`memory_extract_skipped reason=no_activity`); an end while one of the same id is already queued
  or running makes no second job (`reason=nothing_new`). Resume: a resume spawn of a session with
  no save row (Past sessions Open, dead-pane Resume, Resume by id / Import: all set
  `resumeSessionId`, and a Reopen of one keeps it) records its transcript's current size as the
  start (`claudeSpawnCommand` → `memoryResumed` → `Extractor.resumed` → `ExtractState.seedAt`, a
  `done` row with no meta, `ON CONFLICT DO NOTHING`), Memory on or off and in the spawn's resolved
  workspace, so only text after the resume is saved; no row is made with the database closed or
  no transcript (or an empty one), and a found transcript whose size cannot be read logs
  `memory_extract_seed_skipped reason=size`; an in-claude `/resume` is not seeded. Catch-up: the start saves every row the
  last run owed, after the goals and past-sessions stores exist (`memory_catchup_not_ready`
  otherwise). A checkpoint needs Memory on, the database open and a live app-launched card; an
  end needs a turn, then the same; an end after a turn, or a catch-up, with Memory off writes `off`
  on the record and closes the row (R2).
  The transcript is found by its id (`locateTranscript`, D1), never by a hook's `transcript_path`,
  read once per job from the row's byte offset (`transcriptReader.ts`, at most
  `EXTRACT_LIMITS.readBytesPerJob`), cleaned (`sliceCleaner.ts`: no thinking, web, MCP,
  subagent and other agents' results without their text (P3-R3), `<private>` spans replaced by
  the secret mark first (`privateSpans.ts`: any case, an unclosed tag takes the rest of that text;
  operator and claude text, tool arguments and results; each claude text part is cut alone, so a
  span claude splits over two parts is cut only in the first; a Bash command that holds the
  tag is not captured), secrets replaced, `secretScan.ts`); what memory itself told the session (a block that starts
  `Memory (Claude Watcher):`, a system-reminder) is never operator text, and a typed prompt or a
  tool result that holds the marker anywhere (any case or spacing) is not kept as evidence
  (P3-R2, P3-C5, P3-C8, P3-C9); the slice is then cut into chunks; a job of
  fewer than
  `EXTRACT_LIMITS.minPrompts` typed prompts makes no call (`reason=guard`). No transcript: a
  checkpoint waits; an end or a catch-up whose row never read a conversation entry (no entries,
  prompts or notes: a session that never got a prompt, or a row seeded at a resume) ends like the
  guard, record `nothing`, no push (R49); one whose file went missing after a read ends `failed`. One call at a time for
  the whole app, one job per session in a queue of `EXTRACT_LIMITS.queue` (a full queue refuses a
  checkpoint, never an end: `memory_extract_queue_full`), at most `chunksPerJob` calls per job
  (the rest waits for a later save point or the next start). The call (`headlessClaude.ts`,
  `composeExtractCommand`; each flag probed on claude 2.1.323): `$SHELL -l -c` running
  `claude -p` with `--model`, `--output-format json`, `--json-schema`, `--system-prompt`,
  `--no-session-persistence`, `--setting-sources ''`, `--tools ''`, `--strict-mcp-config`,
  `--disable-slash-commands` and `--max-budget-usd 1` (with these it fired no hook, wrote no
  transcript and made no auto-memory folder), the slice on stdin (never argv), its own process group, cwd
  `<userData>/memory-extract` (0700, made by `createExtractCall`), env = the sessions' base env
  without every `CLAUDE_WATCHER_*` and `CLAUDECODE` (R18), plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`;
  `timeoutMs` 120 s, then SIGTERM to the group and SIGKILL 5 s later; stdout capped at 1 MiB. Its
  result passes `ClaudeResultSchema` then `ExtractOutputSchema`, else the call failed. A candidate
  is kept only when its quote stands as whole words in the cleaned slice (a value next to a dotted
  or hyphenated continuation is not whole, R15), holds no secret and is not an item the operator
  wrote (D16); its basis is where the quote was found. A check (a command later sessions are told to run) must stand whole in the quote's entry or in any entry but claude's prose, else `evidence_not_found`; a task update that brings a check needs a sighting, else `claude_only`. An update that only claude's own text or a
  tool call supports is dropped (`claude_only`, P3-R1). A save updates a fact only when it brings a
  new exact value (a token of at least 4 characters with a digit, `_`, `/` or `.`,
  `memory/exactTerms.ts`) that stands in the entry its quote was found in; a reworded or renamed
  fact, an operator's prose correction, or one whose only new value is shorter (`Node 22`, port
  `80`), is edited by hand (`no_new_value`, `No new exact value`: its quote is a sighting, so not
  `claude_only`; P3-C6, P3-C11, P3-C30). Drop reasons live only in the session's activity (RAM)
  and the `memory_candidates_dropped` log line. Only a quote found in a tool result or in
  the operator's text moves an item's (a `none`) or a task's (an update) last-seen date; claude
  repeating what memory told it moves nothing (R48). A recall block itself is never evidence (its
  marker, `sliceCleaner.ts`), but a recalled value claude writes with its own tool call, when the
  tool result shows it (an Edit snippet, `echo` in Bash), counts as `observed` (a `none` moves the
  item's last-seen date, an update can be kept); and a save can add a task whose title restates a
  recalled value in claude's words (`inferred`, quoted from claude's text). A save never closes, pins or deletes: open
  work becomes a task (`settings.memorySaveTasks`) and a session only flags one (`task_report`).
  Three failed calls in a row give a chunk up (`memory_extract_gave_up`; the job ends `failed`).
  Version: `MIN_EXTRACT_CLAUDE_VERSION` (2.1.323; an unreadable version runs). The gate reuses the
  launch path's `--version` answer (`createVersionReads`, R37) and keeps an OK answer for the run;
  a too-old claude never closes a session (its row stays owed, R30), its `failed` push goes out
  once per run, and the extractor asks again only after 10 minutes (R31).
  A result is pushed to every window on `memory:extract-result` (an end always, unless the guard
  skipped it or the session has no name; a checkpoint or catch-up only when it failed), held in
  main until the first window loaded (`ipc/extractResultPush.ts`, R38) and buffered by the
  preload until the renderer listens (R39). Quit: `teardownAllSessions` calls `quitExtractor`
  first, before the archive: the call in flight gets `killNow()` (SIGKILL to its group at once,
  R17, never the 5 s grace) and nothing more starts; the next start catches up. Delete,
  `Forget` and a dropped record cancel that session's job (`cancel()`) and delete its save row.
  Memory switched off (`settings:set`, `memoryOff`) cancels the call in flight; the job checks
  Memory again after the call and writes nothing of it; an end or a catch-up stopped so is closed
  `off` (R51, R2). A child pid is signalled only when it is an integer over 1 (`-1` would reach
  every process of the user, R51). Each record's memory state lives in
  `claude-watcher-past-sessions-memory.json`, never in the Past sessions record (R50).
  Logs (`[claude-watcher][memory]`, codes only): `memory_extract_started trigger=`,
  `memory_extract_done trigger= saved= dropped=`, `memory_extract_failed reason=` (the call's
  `spawn`/`timeout`/`exit`/`envelope`/`output`/`cancelled`, `claude_version`, `write` R21,
  `internal` R32), `memory_extract_invalid path= issue=`, `memory_extract_gave_up`,
  `memory_extract_no_transcript`, `memory_extract_skipped reason=off|guard|not_launched|nothing_new|no_activity`,
  `memory_extract_queue_full`, `memory_extract_end_missing`,
  `memory_extract_seed_skipped reason=size` (a resume seed with no size), `memory_extract_state_invalid count=`
  (a bad save row is skipped, R33), `memory_candidates_dropped reason= count=`,
  `memory_extract_cancelled`, `memory_extract_result_invalid` (the push),
  `memory_extract_result_held_dropped` (a full hold in main or the preload buffer drops its oldest),
  `memory_task_write_failed`, `memory_goal_carry_failed` and `memory_planner_note_failed` (the
  spawn seam's Reopen carry and planner record), `memory_goal_created folder=yes|no memory_goals=`
  (a save made a memory goal; the memory goals now in that workspace),
  `memory_cascade_failed step=forget|rows` (a workspace delete's memory step; `memoryStartup.ts`
  logs it with no step), `memory_extract_kill_failed signal=`
  (`headlessClaude.ts`); the Past sessions store adds `past_sessions_memory_<problem>`. Known
  limits: a turn interrupted with Esc sends no `Stop`, so its text waits for a later resume that
  finishes a turn, except in a session with no save row yet (it never finished a turn while
  Memory was on: archived or quit during its first turn, or only Esc-stopped turns), whose text
  is never saved, since its next resume spawn starts reading at the transcript's end; a `/resume`
  inside claude is saved at the next start, and one with no save row is read from the start of
  its transcript (only a resume spawn is seeded); the start's catch-up has no cap on how many owed
  sessions it saves; a session with turns while Memory was off after its last save point (a
  session with no row, not seeded since, or one with a row) is saved from its row's offset (0
  with no row) by its next save that runs, so its Memory-off text is read: any turn with Memory
  on since that save point, before or after the Memory-off turns, lets an end with Memory on run
  (older behaviour, not from the resume seed or the turn rule; fixing it needs to know whether
  Memory was ever off for the card, and seeding at the first Memory-on `Stop` would drop a normal
  session's first turn); there is no job watchdog beyond the call's own time limit. A
  deleted session (Past sessions `Forget`, or a card's `Delete`) has its save forgotten and keeps
  its items and commands, marked
  `Session deleted` (`pastSessions.ts` `onRemove` → `markSessionsDeletedInMemory`), and so does a
  session whose record left without one: a workspace cascade's (its workspace items are already
  deleted, memory runs first in `persistence/workspaceCascade.ts`, so only its global items are
  marked) or the 200 cap's (`onDropped`). A workspace delete's cascade deletes the workspace's
  items, commands and save state, after the extractor cancels that workspace's saves
  (`memoryCascadeStep`). The card's Delete confirm (`StopConfirm`) asks how many items the session saved
  (`memory:session-count`, by the renderer's session id) and, only when the operator ticks its
  box, deletes them (`memory:delete-session`) AFTER main confirmed the session delete
  (`lib/sessionExit.ts`): a refused session delete never costs memory, and a refused memory
  delete is an error toast with the items still marked. "The items the session saved" (the
  count, the delete, the `Session deleted` mark) leave out an item whose origin is the operator
  (`origin.by = 'operator'`: a `/remember` line), which keeps the session id as provenance
  (`SAVED_BY_SESSION` in `memoryStore.ts`, P3-C29). The dialog's `Same value` flag is computed when
  it reads (`memory/memoryTwins.ts`: two active specifics, same workspace and folder, same value
  holding an exact term; `memory:list` answers `twinIds`, `memory:get` `twins` and `twinsMore`):
  nothing is stored, nothing is changed, and no session is told. Memory text (key, value, title, body, check, reason, query)
  never reaches a log, a notification, the API or an attention event (logs carry `code=` only).
  SMOKE opens no database (memory is off); its memory check writes into a temporary folder, never
  userData.
- **Missing folder refused before anything registers** (UX-11): `launchService.launch` takes a
  required `isDirectory`, throws `folder_missing` (in-app: a toast over the name prompt "That folder
  no longer exists."; API: 409 before the 503s). Dead-pane Reopen not checked. Hook server unbound → API 503
  `hooks_unavailable` (after `claude_version`, before `no_window`).
- **Every claude spawn goes through `loginShellRun`** (`pty/claudeBin.ts`: the session, the
  `--version` probe, the headless save call). The command is POSIX-quoted (`shellQuote`), so a
  POSIX login shell (sh, bash, zsh, dash, ksh) reads it as before; any other (fish) reads only
  `exec /bin/sh -c "$CLAUDE_WATCHER_LAUNCH_CMD"`, and `/bin/sh` unsets the var before it execs
  claude. Sensor: `src/main/pty/loginShellRun.test.ts` (real bash and fish).
- **Identity minted at launch:** `claude --session-id <uuid>`; card synthesized immediately via
  `reducer.upsertLaunched` (status `Connecting`). Identity = stable `id`, never `pid`.
- **Hooks own every status transition** (POST to `127.0.0.1:9279/h/<token>/`). **Zero footprint:**
  `hookSettingsFile.ts` writes each session's hook block into its own file in userData
  (`<userData>/hooks/<random>.json`, folder 0700, file 0600, `sessionFiles.ts`, shared with the
  `--mcp-config` files); `composeClaudeCommand` passes `--settings <path>`. Scoped to app-launched
  sessions only; merges with project settings. A stale block the retired merger left posts to the
  bare URL and gets 401. The file follows `/clear` and goes with the card (`window/cardState.ts`);
  a start (not SMOKE) deletes files a previous run left and the old shared
  `claude-hooks.settings.json`. (Replaced `registerHooks`, which wrote `.claude/settings.local.json`
  into every cwd — the app does not clean those up.) All input via `hookEvent.ts`
  (`.passthrough()`; malformed known key → 400 + drop + log path/code). `hookStatus.ts` = the only
  event→status map; `pty/approvalKey.ts` = the only keystroke→status map (R4).
- **A session id is no credential (T-D13):** it is on claude's argv, readable through /proc by
  any OS user. Each spawn mints one channel token (64 lowercase hex, `hooks/hookChannel.ts` on
  `mcp/sessionTokens.ts`: memory only, sha256 + `timingSafeEqual`, app-global) only while the hook
  port is ours, and hands it only to the settings file and the bridge mod's env, never to argv;
  unused, it is revoked. `hookServer.ts`: every path but the bearer routes must be
  `/h/<token>` + `/`, `/mod/report` or `/mod/prompt` with a live token, else 401
  `code=channel_unauthorized` before the body is read (a bare `/` too; an unknown route after a
  live token is 404); the token is resolved again at the body end (revoked meanwhile: 401); a
  hook, report or prompt origin that names a LIVE session other than the token's own is 403
  `code=channel_session_mismatch` before any handler or `takePendingTitle`
  (`channelAllows`: own id, or an id no card holds, which keeps `/clear` adoption working).
  `/clear` moves the token and file, a removed card revokes and deletes them, a Reopen revokes
  the replaced id's first, a resume mints fresh (`pty/claudeSpawnCommand.ts`). Logs never hold
  the token or a URL. Memory treats `/h/<token>` in a transcript as a secret (`secretScan.ts`). Probed on claude 2.1.331: an http hook keeps the URL's path. Not covered:
  a token holder adopting another card through `/clear` (`sessionRebind.ts` proof only). Sensor:
  `src/main/hooks/hookServer.channel.test.ts`, `src/main/pty/claudeSpawnCommand.test.ts`.
- **No bind, no `--settings` (SEC-6):** `hookSettingsPathIfListening` gives the flag only while
  THIS process holds the hook port (`serverHealth.ts`). Otherwise the session runs without status
  and `ServerHealthBanner` (`CH.serverHealth`/`serverHealthGet`) says `port_in_use` /
  `server_error` / `hooks_file_failed`. Never withhold silently; never send without the bind. POST
  with an `Origin` header → 403 before body read (SEC-2; claude sends none — re-probe if cards stop
  moving after an upgrade).
- **Every exit has a reason.** Archive, Ctrl+C×2, `/exit`, pty exit, `SessionEnd`, app quit, window
  close → reason `archive`: snapshot into `claude-watcher-past-sessions.json`
  (`persistence/pastSessions.ts`, v1, cap 200, cascades on workspace delete; a record's memory
  state lives in `claude-watcher-past-sessions-memory.json`, R50) BEFORE the reducer
  drops it. Quit/close fire no pty onExit, so `archiveBoundSessions` (`pty/launchRemoval.ts`) runs
  first — in `teardownAllSessions` before `destroyAll` (only memory's `quitExtractor` comes
  before it), and in `teardownWindowTerminals` before
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
  from `hooks/toolDetail.ts`, follows the name, and shows on the card and on the OS notification's second body line (escaped on Linux, where KDE reads the body as markup: `osNotificationBody`)
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
