# CLAUDE.md

claude-watcher: KDE-first Electron app that watches local `claude` sessions and embeds live
terminals for them. v1 (Epics 0–5) done; Epic 6 replaced the external `c9watch` CLI with a native
session engine (several dir/channel names keep the historical `c9watch` prefix).

`IdeasBoard.md` tracks new work. Remove an item when it is done or discarded. Never implement an
item right away: validate it with a systematic approach (bmad / superpowers), then implement the
same way.

## Never commit (`.gitignore`) — this repo is PUBLIC

Planning records hold home paths, work email and internal names:

- `docs/superpowers/` (specs/plans — write there, never `git add`; a skill step saying "commit the
  spec" stops at the write), `_bmad-output/`, `_bmad/`, `.claude/skills/` (one tracked file under
  `_bmad-output/planning-artifacts` stays), `.claude/settings.local.json`.
- Build/test output: `node_modules`, `dist`, `out`, `test-results/`, `*.tsbuildinfo`,
  `.eslintcache`, `*.log*`. Never `git add -f`.

## Commands

`npm run dev` (HMR) · `build` (typecheck + bundle) · `build:dir` (packaged) · `typecheck` ·
`lint` · `format` · `test` / `test:watch` (Vitest) · `test:e2e` (Playwright-Electron) ·
`smoke` (after `build:dir`, or `smoke:packaged`) · release: `.claude/rules/release.md`.

Single test — Vitest projects `unit` (jsdom) and `main-unit` (node):
`npx vitest run <file>` · `npx vitest run --project main-unit -t "desync"`.

**Three profiles, three port sets — never ask the operator to close anything:**

| Profile                                                | hook  | API   | userData                         |
| ------------------------------------------------------ | ----- | ----- | -------------------------------- |
| default (packaged, smoke, e2e)                         | 9279  | 9281  | `~/.config/claude-watcher`       |
| dev (`npm run dev`, signal `ELECTRON_RENDERER_URL`)    | 19279 | 19281 | `~/.config/claude-watcher-dev`   |
| drive (`CLAUDE_WATCHER_PROFILE=drive`, `tests/drive/`) | 29279 | 29281 | `~/.config/claude-watcher-drive` |

Dev window title ends `(dev)`. `src/main/profile.ts`.

**Visual changes:** tests cannot see CSS. `npm run build`, then drive the built app
(`tests/drive/driveApp.mjs`) — recipe in `.claude/rules/run-app.md`.

**Gates:** `typecheck / lint / test / build`. Changes touching node-pty / preload / packaging also
need `build:dir` + `smoke` (proves node-pty survives packaging — load-bearing).

## Architecture

- `src/main/` — main process. **node-pty runs HERE only.** `c9watch/` (reducer → enrich → ship;
  historical name), `hooks/` (hook ingest), `pty/`, `kde/`, `lifecycle/`, `persistence/`, `api/`,
  `themes/`. Main is the **single source of truth for session state**.
- `src/preload/` — typed `contextBridge` seam; renderer never gets `ipcRenderer`/Node.
- `src/renderer/` — React UI (sandboxed), view-state in Zustand (`stores/boardStore.ts`).
- `src/shared/` — `ipc/contract.ts` (`CH` registry + payload types), `schemas/hookEvent.ts`
  (hook-POST adapter), `schemas/session.ts`.
- `src/__fixtures__/` — fake hook feed, launched-session fixtures (never shipped).

Flow (one-way): launch spawn (minted `--session-id`) → `reducer.upsertLaunched`; hook POSTs →
Zod → `reducer.applyHookStatus`; reducer → validated deltas over `CH.watchEvents` → renderer store →
selectors → components. Renderer never invents/mutates session truth.

## Load-bearing constraints (precedence order; read the rule file before touching a layer)

1. **Fail-closed Zod boundaries** (`rules/zod-boundaries.md`): one boundary per input; log error
   PATH + CODE only, never the value. Beats never-crash.
2. **Never-crash past the boundary** — one bad session must not take down the board.
3. **Typed IPC** (`rules/ipc.md`): every channel is `CH.*`, never a literal (ESLint
   `local-ipc/no-literal-channels`). New channel = contract → schema → main handler → preload + test.
4. **xterm imperative** (`rules/terminal.md`): refs only, never `useState`/store; one node-pty per
   xterm; hide kept-alive frames with `visibility:hidden` on the whole frame.
5. **State ownership** (`rules/state.md`): session truth = main; view-state = Zustand; derived =
   selectors. Inject `now()`.
6. **UI shape** (`rules/design.md`): one `ManageDialog` shell for every config surface; banned:
   native `<select>`, bare text `<input>`, `<button className>`, hand-made popovers, bare
   error/success lines (→ `Callout`), raw spacing (→ `--gap-*`/`--inset-*` roles) (each has a
   guard test). Every action ends in visible feedback; async buttons use `useAsyncAction`/`busy`.

**Debugging?** Read `rules/troubleshooting.md` first (Step-0 questions before theorizing).

## Native session engine

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
- **Resume:** `Past sessions…` reopens with `claude --resume <id>` (`resumeSessionId`; id kept) plus
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
- **`status` is not enum-locked.** `pendingToolInput` is polymorphic (object for `Agent`, string
  otherwise) — don't narrow.
- **Status rules:** turn ending with `background_tasks` running = `Working` (until next event; Esc
  always demotes to idle). `PreToolUse`/`PostToolUse` never pull a card out of `NeedsPermission`
  (R20); Enter/`1`/`2` in that terminal → `Working` (R4, `code=permission_answered_key`).
  `pendingToolName` set only while waiting (R14). `SessionStart source:"compact"` ignored (R19).
  Hook body cap 8 MiB (R22).
- **Naming:** NEW code uses `claude-watcher` (files, stores, log prefixes like
  `[claude-watcher][templates]`). Existing `c9watch` dirs/`CH.watch*`/`[c9watch]` logs/
  `c9watch-settings.json` are a PENDING rename (needs a migration) — don't rename in passing.
  `rg -w c9watch src/` must never show a CLI spawn.

## Workspaces

- `Session.workspaceId` is REQUIRED session truth, stamped at launch (`buildLaunchedSession`),
  changed only via `CH.sessionSetWorkspace`. Renderer filters, never writes.
- **Alerts global, cards scoped.** `notifier.notify` and `computeBadgeCount` (`kde/badge.ts`) stay
  unfiltered in main; per-workspace badge is a renderer selector. Only skips: the session being
  looked at (`kde/viewedSession.ts`, `CH.viewFocusedTerminal`, `shouldEmitRaise`), and
  `notificationsEnabled` off (popups only; sound = `soundEnabled`).
- **Notification click raises + opens the session** (UX-12/R29): `kde/notificationActivate.ts` →
  `CH.attentionActivate` → `lib/openFromNotification.ts` (switch workspace, then `activateCard`;
  modal open → select only, re-checked after the switch). A session event never raises the window.
  Notifier holds shown popups (cap 50, R21).
- `Template.workspaceId` / `Shortcut.workspaceId`: `.nullable().default(null)` (null = global).
  `TEMPLATES_FILE_VERSION = 1`, `SHORTCUTS_FILE_VERSION = 3` (v2→v3 migration in
  `parseShortcutsFile`). **Bumping a version without a migration wipes the store.**
- `PastSession.workspaceId` required; cascade deletes records. Record naming a missing workspace is
  hidden but KEPT (`code=past_sessions_hidden_unknown_workspace`, UX-03).
  `PAST_SESSIONS_FILE_VERSION` stays 1; new fields additive.
- **Shortcuts by alias:** `settings.expanderKey` (`Ctrl+Alt+X`) opens `ExpanderBox`;
  `<alias> <values…>` expands `$1..$9`/`$*`/`$$` (`shortcuts/expand.ts`), result is TYPED, never
  submitted. Quoting: `"…"`/`'…'`, `\` escapes, unclosed quote takes the rest (never an error).
- **Workspace switch unmounts nothing** (hidden terminals stay mounted, `active={false}`).
- **Every `window.*` bridge is declared twice**: `src/preload/index.d.ts` AND
  `src/renderer/src/env.d.ts` (test program doesn't see the preload augment). Update both.

## Programmatic API

Read `.claude/rules/api.md`. Core: second listener `127.0.0.1:9281`, off by default, bearer token
in userData; every action is one `defineCommand` in `api/commands/` (router + OpenAPI generated
from `apiCommands`); wire session is state-only `.strict()`; a create never takes the view and
never takes caller prose; `/clear` ends an SSE stream with `session.rebound`.

## Custom themes (`src/main/themes/`)

- Theme = `<userData>/themes/<id>/theme.json` (`shared/schemas/theme.ts`, `.strict()` — unknown
  key/token fails the whole theme) + optional CSS + assets. Main composes ONE stylesheet (tokens,
  CSS with `url()` inlined as `data:`, 5 MB cap) and pushes `ThemeBundle` over `CH.themeApplied`.
- **Liquid Glass and Paper are bundled read-only** (`extraResources` →
  `<resourcesPath>/themes`; dev reads `docs/themes/examples`). `BUNDLED_THEME_IDS` is the one
  list. A user folder with a bundled id is skipped (`code=theme_id_reserved`). Smoke's
  `main.themes.pass` uses a probe scanner over an empty user folder.
- **Fail closed → Default, keep the setting** (`settings.themeId`):
  `code=theme_load_failed id= reason=`, Settings shows the error. Logs: code + zod path only.
- **Wallpapers:** only the chosen one inlined as `--theme-wallpaper`; all validated; pick per theme
  in `settings.wallpaperByTheme`; unknown → first (`code=theme_wallpaper_not_found`).
- `nativeTheme.themeSource` + root `color-scheme` follow the theme's `colorScheme`
  (`themeLifecycle.ts`, `hooks/useApplyTheme.ts`).
- **Every renderer colour is a token** (`styles/noHexLiterals.test.ts`); `TOKENS` in
  `shared/theme/tokens.ts`.
- xterm `allowTransparency` is read at creation only.
- Generated SDK (`docs/themes/THEMES.md`, `theme.schema.json`, `examples/builtin-dark`) is
  drift-tested: `npm run gen:theme-docs`. Rescan on start / Settings open / `Reload themes`.

## node-pty + packaging

Native module: EXTERNALIZED in electron-vite main config, rebuilt via `@electron/rebuild`
(`postinstall`), `asarUnpack`-ed. `npm run smoke` proves it.

## Single instance (`lifecycle/singleInstance.ts`, UX-04)

Lock per userData (profiles don't block each other). Second launch quits
(`code=already_running`), first raises its window. SMOKE skips the lock.

## Storage health (`src/main/storageHealth.ts`, UX-06/07)

Stores report to one collector → `CH.storageHealth` (name + code only) → `StorageNotice`. **A
dialog Save/Delete the disk refuses is UNDONE and throws `store_write_failed`** (`commit()`); every
Manage dialog maps it to `STORE_WRITE_FAILED_COPY` (a new dialog owes it). Other writes keep the
change and report `write_failed` (`persistOrReport()`; removal paths never throw). Also
`corrupt_reset`, `read_failed`. Workspace delete commits before its cascade.

## Security (never weaken)

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. **Smoke channels exist only
under `C9_SMOKE=1`** (`smoke/smokeIpc.ts`, SEC-8): `CH.ptyStart`/`ptyInput`/`ptyResize`/
`smokeReport` go through `registerSmokeIpc`; `CH.smokeConfig` is always registered.

## No application menu (`appMenu/appMenu.ts`)

Linux/Windows: none; macOS: app + Edit only. The default menu ate claude's keys (Ctrl+R, Ctrl+M,
F11, Alt). Never bring back `optimizer.watchWindowShortcuts`. DevTools in dev = F12 only.
Playwright key presses skip accelerators — can't prove a key reaches the pty.

## Focused-view keys (`lib/terminalFocus.ts`, R1/R27/R10)

claude keeps every key while its terminal has focus (Ctrl+W, Ctrl+N, Esc). App keydown skips keys
from inside `.xterm` (`isInsideTerminal`). **No key archives** (R27) — only the Archive button.
Focus lands IN the terminal on every switch (`takeFocus`), never from a hidden mount or out of an
open dialog. `Esc to return` shows only while focus is outside.

## Enforcement

- **Strict TS** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`). Never drop a flag — fix the consumer.
- Hooks (`.claude/hooks/`): PostToolUse runs `tsc` + `eslint` on edited TS; Stop runs `vitest run`.
- ESLint: `no-floating-promises`, `consistent-type-imports`, `no-literal-channels`.
- `code-reviewer` subagent: fresh reviewer re-runs the gate and fault-injects every guard
  (reverting it must turn a test red).

## Versions (don't bump in passing)

Electron **44** (ABI 149), zod 4, zustand 5, React 19, @xterm/xterm 6, node-pty 1.1, Vitest 4.
Electron 44 notes: `npm install` doesn't download the binary (first run or
`npx install-electron --no`); a new major needs a `node-abi` that knows it; main `clipboard` is
async; Playwright `firstWindow()` resolves before `loadFile` — wait for the page first.
