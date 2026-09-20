# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

claude-watcher is a KDE-first Electron desktop app that watches local `claude`
sessions and embeds live terminals for them. v1 (Epics 0–5) is feature-complete;
Epic 6 replaced the external `c9watch` CLI with a native session engine (the app
name and several dir/channel names keep the historical "c9watch" prefix).

The following file: IdeasBoard.md
Is used to keep track of new work on the app. When something is discarded or completed it must be removed from the file to keep it updated.
Items in that board should never be implemented right away. They should always be validated using a systematic approach like bmad or superpowers plugin. Once approved
implementation should also follow a systematic approach.

## Commands

| Task                                   | Command                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| Dev (HMR)                              | `npm run dev`                                                    |
| Build (typecheck + bundle)             | `npm run build`                                                  |
| Packaged build (`--dir`)               | `npm run build:dir`                                              |
| Typecheck (node + web + test projects) | `npm run typecheck`                                              |
| Lint (flat config, type-checked rules) | `npm run lint`                                                   |
| Format                                 | `npm run format`                                                 |
| Unit/integration tests (Vitest)        | `npm run test`                                                   |
| Watch tests                            | `npm run test:watch`                                             |
| E2E (Playwright-Electron)              | `npm run test:e2e`                                               |
| Packaged node-pty smoke gate           | `npm run smoke` (after `build:dir`, or `npm run smoke:packaged`) |

**Running a single test** — Vitest has two projects (see `vitest.config.ts`): `unit`
(jsdom) and `main-unit` (node). Target one file or test:

```bash
npx vitest run src/main/c9watch/reducer.test.ts          # one file
npx vitest run --project main-unit -t "desync"           # one test by name (main-side)
npx vitest run --project unit src/shared/schemas         # one project / dir
```

**Seeing a visual change in the real app** — tests cannot see CSS, stacking or pixel alignment.
`npm run build`, then drive the built app from a scenario script on `tests/drive/driveApp.mjs`
(Playwright-Electron, real `claude`, real hook POSTs, screenshots). It needs 127.0.0.1:9279
free, so the installed app must be closed. Recipe and gotchas: `.claude/rules/run-app.md`.

**Gate buckets.** Most changes gate on `typecheck / lint / test / build`. Only changes
touching node-pty / the preload seam / packaging additionally require `build:dir` +
`smoke` (the packaged-native gate). The `smoke` script proving node-pty survives
packaging is load-bearing — do not regress it.

## Architecture — three process layers + shared

Code lives in four trees; the boundaries between them are the whole design:

- **`src/main/`** — Electron main process. **node-pty runs HERE, never in the renderer.**
  Subdivided into `c9watch/` (the reducer → enrich → ship pipeline; the dir name is
  historical — the c9watch CLI is retired), `hooks/` (the :9279 hook ingest), `pty/`
  (terminal/launch lifecycle), `kde/`, `lifecycle/`, `persistence/`. Main is the
  **single source of truth for session state**.
- **`src/preload/`** — the typed `contextBridge` seam. The renderer gets ONLY these
  functions, never `ipcRenderer`/Node directly. `index.d.ts` augments `Window`.
- **`src/renderer/`** — React UI (sandboxed). Reaches IPC only through `window.*` bridges.
  View-state lives in a Zustand store (`src/renderer/src/stores/boardStore.ts`).
- **`src/shared/`** — imported by BOTH sides: `ipc/contract.ts` (the `CH` channel registry and payload types), `schemas/hookEvent.ts` (the Zod hook-POST adapter — the ONE external
  boundary), and `schemas/session.ts` (the Session storage/renderer shape).
- `src/__fixtures__/` — the fake hook feed + launched-session fixtures (test doubles;
  never shipped).

### The data flow (one-way)

```
launch spawn (minted --session-id) ──> reducer.upsertLaunched ─┐
claude hook POSTs (127.0.0.1:9279) ──> Zod-validate            ├─> reducer (Map<id,Session>)
   (hookEvent.ts) ──> reducer.applyHookStatus ─────────────────┘
   ──> validated deltas over CH.watchEvents ──> renderer Zustand store ──> selectors ──> components
```

Session truth flows main → renderer; view intent flows back via typed IPC. The renderer
never invents or mutates session truth — it renders a projection of what main sends.

## Load-bearing constraints (the non-obvious ones)

Detailed standards live in `.claude/rules/*` — read the relevant file before touching
that layer. The high-frequency rules, in **precedence order** (earlier wins on conflict):

1. **Fail-closed Zod boundaries** (`.claude/rules/zod-boundaries.md`). Every external input
   is validated at exactly ONE boundary that fails closed. A bad hook POST gets a 400 +
   drop + log **by error PATH + CODE only — never the value** (a ZodError stringifies its
   input, which may carry prompts / assistant prose / tool input). This BEATS never-crash.
2. **Never-crash past the boundary** — one bad session/line must not take down the board.
3. **Typed IPC seam** (`.claude/rules/ipc.md`). Every channel is a `CH.*` const from
   `src/shared/ipc/contract.ts`, NEVER a string literal (enforced by the authored
   `local-ipc/no-literal-channels` ESLint rule). Adding a channel touches 4 files in
   lockstep (contract → schema → main handler → preload wrapper) + a test.
4. **xterm owned imperatively** (`.claude/rules/terminal.md`). Terminals live in refs,
   NEVER React `useState`, and are NOT in the store. One node-pty per xterm; transport is
   Electron IPC (a `MessagePort` forwarded to the main world). Kept-alive frames hide with
   `visibility:hidden` on the whole frame (not `display:none`, not just the inner host).
5. **State ownership** (`.claude/rules/state.md`). Session-truth = main; view-state =
   renderer Zustand; derived = narrow selectors (never persisted). Inject `now()` for
   determinism.
6. **UI shape** (`.claude/rules/design.md`). The Manage dialogs (Templates / Shortcuts /
   Workspaces) share ONE shell, `components/ManageDialog/` — a header scope dropdown, a FLAT
   row list (never sections; row actions only in `ManageDialog.RowActions`), a form, and a
   `[Delete] [Save]` footer. Destructive actions arm
   in place and are red-outlined at rest; a workspace is always drawn with `WorkspaceDot`.
   **A native `<select>` is banned** — Chromium paints its popup from the desktop's GTK theme,
   so it comes up light on a dark app; use `components/Select/Select.tsx`. **A bare
   `<input type="text">` is banned too** — five dialogs had grown five drifting copies of the
   same `.input` CSS rule; use `components/TextInput/TextInput.tsx` (its test fails if any other
   module declares an `.input`/`.search` class). Read the sibling dialog before laying out a
   new one.

**Debugging a symptom?** Read `.claude/rules/troubleshooting.md` first — run its Step-0
questions (data present? depends on a sibling? console empty?) to pin the layer before
theorizing. Note its trap: the `tests/e2e/two-launch-screenshot*` diagnostics were not
trustworthy and have been removed; a manual repro with real `claude` is the reliable signal.

### The native session engine (the c9watch CLI is retired — Epic 6)

- **Minimum claude is 2.1.245, enforced at launch** (`src/main/pty/claudeVersion.ts`). The
  spawn passes `--session-id`, `-n` and `--settings`; a claude that does not know one of those
  does NOT degrade — it rejects the argument and the session dies instantly. `CH.sessionLaunch`
  probes `$SHELL -l -c "<claude> --version"` (the same shell the spawn uses), blocks with a
  native error box naming both versions, and caches ONLY the ok verdict so an upgrade unblocks
  without an app restart. It **fails OPEN** on an unreadable/unparseable version — the one
  deliberate inversion of the fail-closed default, because a false block bricks a working
  install. Bump the floor only alongside a re-verification of those three flags.
- **Identity is minted at launch:** the app spawns `claude --session-id <uuid>` with a
  caller-minted UUID (verified on claude 2.1.199), so the terminal↔session binding is
  EXACT at spawn. The board card is synthesized IMMEDIATELY via `reducer.upsertLaunched`
  (status `Connecting`) — no discovery wait, no pid-ancestry correlation for new launches.
- **Hooks own every status transition:** Claude Code lifecycle hooks POST to
  `127.0.0.1:9279`. **ZERO FOOTPRINT — the app writes into NO project and NO user settings
  file.** `hookSettingsFile.ts` writes the hook block into the app's OWN data dir
  (`app.getPath('userData')`) and `composeClaudeCommand` hands it to each spawn as
  `--settings <path>`, so the hooks scope to EXACTLY the sessions the app launches and a
  plain `claude` in the same folder stays silent. Probe-verified on claude 2.1.245:
  `--settings` MERGES with the project's own settings (an operator's own hooks/permissions
  survive), and a stale block on the same URL is DEDUPED against the flag (one POST, not
  two — which is what keeps the name-sync push-once safe).
  This REPLACED `registerHooks`, which merged the block into
  `<picked cwd>/.claude/settings.local.json` and left a permanent trace in every directory
  the app was ever launched in. The app does NOT clean those up — they are the operator's
  file to edit. ALL hook input goes through
  the ONE fail-closed Zod adapter `src/shared/schemas/hookEvent.ts` (`.passthrough()` so
  additions pass; known-key malformations fail closed → 400 + drop + log path/code only,
  NEVER the body — payloads carry prompts/`last_assistant_message`/tool input).
  `hookStatus.ts` is the ONLY event→status mapping.
- **Removal is stop/exit-driven, and every exit names its REASON (past sessions):** in-app
  Archive, `Ctrl+W`, `Ctrl+C` twice, `/exit`, a pty exit, the belt-and-suspenders `SessionEnd`,
  an app QUIT and a WINDOW CLOSE all remove the card with reason `archive` — main snapshots the
  card into `claude-watcher-past-sessions.json` (`src/main/persistence/pastSessions.ts`, state
  only, v1, cap 200, cascades on workspace delete) BEFORE the reducer drops it. Quit and window
  close fire NO pty onExit (`destroyAll`/`stop` dispose the exit listener before the kill), so
  they run `archiveBoundSessions` (`src/main/pty/launchRemoval.ts`) FIRST — in
  `teardownAllSessions` before `destroyAll`, and in `teardownWindowTerminals`, which the `closed`
  handler runs BEFORE `teardownWatchFeed` drops the window's seam. It never throws (a failure logs
  `code=teardown_archive_failed` and the quit goes on). `Delete` (after the confirm)
  removes with reason `delete`: no record, and any earlier record for that id is dropped — on a
  pane whose claude already exited too: the launch override keeps the terminal's LAST bound id
  (`LaunchOverride.lastSessionId`, moved by `rebind` on `/clear`), and `CH.sessionDelete` drops
  that record (`deleteTerminalSession`; the renderer's `sessionId` is only a hint). Delete
  never touches claude's own files. `Past sessions…` (last ☰ row) reopens a record as a live card
  with `claude --resume <id>` (the launch service's `resumeSessionId`; the minted id IS the
  record's id — probe-verified 2026-09-18 on claude 2.1.277 that `--resume` keeps it). The
  `session.removed` from a late `SessionEnd` stays idempotent (no card ⇒ no record, no log).
- **A rename waits for the next prompt, and the card says so:** `Session.nameSyncPending` (set by
  an in-app rename, cleared when the hook server takes the pending title) draws the `⟳` mark;
  `pendingTitles.rebind` moves a pending rename with the card on `/clear` (`adoptCard`), which is
  what fixed "rename, then /clear, then the card reverts".
- **Unknown-id hook events are no-ops** (`hook_unknown_id` log): hooks never synthesize a
  card — external (non-app-launched) sessions stay off the board (Story 3.3 ship gate).
- **Claude changes its own session id mid-run (`/clear`) and the card must follow**
  (`src/main/hooks/sessionRebind.ts`). The same process and pty continue under a NEW id, so
  every later hook would be `hook_unknown_id` and the card would freeze on its last status.
  Adoption is tried with an EXACT proof first: claude 2.1.257 records each live process's
  current id in `~/.claude/sessions/<pid>.json` (`src/main/pty/claudeSessionFile.ts`, the
  THIRD fail-closed Zod boundary — never log it, it carries cwd + name), and a launched
  terminal whose process tree records the unknown id adopts it — no cwd, no window. The
  older cwd + single-match + alive + 5-minute-window heuristic remains as the fallback; it
  froze a monitor session for hours on 2026-09-01 when the first accepted hook came 24 min
  after `/clear`, which is why the exact proof exists. Log codes: `hook_sessionend_pty_alive`,
  `hook_session_id_rebound proof=pid|cwd`, `hook_rebind_window_expired`.
- **Identity = the stable `id` (UUID), never `pid`** — pid is a wandering claude thread id.
- **`status` is NOT enum-locked** (a new status string must not fail the session closed).
- **`pendingToolInput` is polymorphic** (object for `Agent`, string for others) — do not narrow it.
- **Historical naming:** the `src/main/c9watch/` dir, the `CH.watch*` channel names, and
  the `[c9watch]` log prefixes predate the retirement — they are names, not a CLI
  dependency. `rg -w c9watch src/` must never show a spawn/exec of the CLI.
- **Naming — `claude-watcher` for NEW code, rename of the rest is PENDING.** Decided
  2026-09-02: every NEW file, store name, log prefix and identifier uses `claude-watcher`
  (e.g. `[claude-watcher][templates]`, `claude-watcher-templates.json`), never `c9watch`.
  The EXISTING `c9watch`-prefixed dirs, `CH.watch*` channels, `[c9watch]` log prefixes and
  the `c9watch-settings.json` store file are a PENDING rename (the store file needs a
  migration so settings survive). Do not rename them in passing — one dedicated change.

### Workspaces

- **Every session carries a `workspaceId`** (`src/shared/schemas/session.ts`) — session TRUTH,
  REQUIRED (not optional), stamped at launch synthesis from main's own active workspace
  (`buildLaunchedSession`) and changed only by `CH.sessionSetWorkspace`. The renderer FILTERS on
  it and never writes it.
- **Alerts are global, cards are scoped.** `notifier.notify` and the `computeBadgeCount` call
  (`src/main/kde/badge.ts`) in `src/main/index.ts` must stay unfiltered — the per-workspace badge
  is a renderer selector (`selectNeedsYouCountByWorkspace`). Do NOT add a workspace filter in
  main; it would be a drift-prone duplicate.
- **`Template.workspaceId` / `Shortcut.workspaceId` use `.nullable().default(null)`** (null =
  GLOBAL) and the file versions stay `TEMPLATES_FILE_VERSION = 1` / `SHORTCUTS_FILE_VERSION = 3`
  (v2 → v3 is the ONE migration, in `parseShortcutsFile`; a chord sequence became an alias).
  Bumping either WITHOUT a migration makes every existing file fail closed → backed up → started
  EMPTY, losing every saved template and shortcut — the warning still stands for templates, and
  for any future shortcuts bump that skips the migration step.
- **`PastSession.workspaceId` is REQUIRED and the workspaces cascade deletes the records** (a
  record never names a missing workspace; one that does, from a hand-edited file, is dropped on
  load by code). `PAST_SESSIONS_FILE_VERSION` stays 1; new fields are additive `.default()`s.
- **Shortcuts are reached by ALIAS, not by a chord of their own.** One chord
  (`settings.expanderKey`, `Ctrl+Alt+X` by default) opens `ExpanderBox` inside the focused
  terminal; `<alias> <values…>` expands `$1..$9` / `$*` / `$$` (`src/renderer/src/shortcuts/expand.ts`,
  pure) and the result is TYPED over the port, never submitted. Any other `Ctrl+Alt` chord still
  reaches the pty untouched.
- **A workspace switch unmounts NOTHING.** Hidden terminals stay in `launchedTerminals` and
  render `active={false}` → `visibility:hidden` on the whole frame. Live xterms accumulate
  across workspaces; bounding that memory is a separate IdeasBoard item.
- **Every `window.*` bridge is declared twice** — in `src/preload/index.d.ts` (which the web
  build program sees) and again in `src/renderer/src/env.d.ts` (because the `tsconfig.test.json`
  program does NOT see the preload's augment, and sources its types from the shared contract
  instead). Adding a bridge method and updating only one of them typechecks in one program and
  fails in the other. Update both. (Bit the Workspaces implementation twice.)

### Programmatic API (`src/main/api/`)

Full rules: `.claude/rules/api.md`. The load-bearing shape:

- **A SECOND `node:http` listener on 127.0.0.1:`apiPort` (9281), OFF by default**
  (`settings.apiEnabled` / `settings.apiPort`, settings version stays 1). Loopback only — never
  `0.0.0.0`. Every `/v1/*` request carries a bearer token read from `claude-watcher-api-token` in
  `app.getPath('userData')` (0600, chmod-ed once per process — on the first read that finds an
  existing file; `current()` caches) — never in `settings.json` (the renderer
  reads that blob), never logged. `createApiLifecycle` starts/stops/restarts it from the settings
  store: first apply on the window's `did-finish-load`, `stop()` on `will-quit`.
- **Every action is a registry entry** (`src/main/api/commands/`): ONE `defineCommand` object with
  separate Zod `params` / `query` / `body` / `output` schemas, a `handler` (or a `stream`), and the
  error statuses it can answer. The router (`apiServer.ts`) AND `/openapi.json` (`openapi.ts`) are
  both generated from the ordered `apiCommands` list in `commands/index.ts`, so a new action is one
  file + one entry + a test and NEVER touches the server. Errors are `{ error: { code, path? } }`
  and the codes ARE enum-locked (`API_ERROR_CODES` in `src/shared/schemas/api.ts`) — the opposite
  call to `status` / `hook_event_name`, because we mint every one of them.
- **The API sees exactly what the board sees.** `ApiSeam` (one per window, registered beside
  `launchBoardSeams` in `src/main/index.ts`) fans the enriched delta out to open SSE streams from
  INSIDE `handleDelta`'s board-ship gate, so an external (non-app-launched) session reaches no
  client either. The wire session is a STATE-ONLY projection (`apiSession.ts` → the `.strict()`
  `ApiSessionSchema`): no `firstPrompt`, no `latestMessage`, no `pendingToolInput`, no `pid`. Strict
  is what makes that a guarantee — a new `Session` field shows up as a dropped frame
  (`code=session_projection_failed`), never as content on the wire.
- **Config is readable, session content is not.** `GET /v1/workspaces` (id, name, color, `active`)
  and `GET /v1/templates` (the WHOLE template, `initialPrompt` included) read the stores, so they
  need no window. `?scope=<workspaceId|global>` is STRICT (a workspace never pulls in the global
  templates); an unknown id is 404 `workspace_not_found`.
- **An API launch IS a UI launch — except that it never takes the view.** Main registers the recipe
  with the same launch service the `+ New session` popover uses and pushes `CH.launchRequested`
  (validated at source); the renderer answers with `registerLaunchedTerminal` — REGISTRY ONLY, never
  the popover's `openLaunchedTerminal`. That is enough to open the terminal (the registry key keeps
  it in `selectKeptAliveTerminalIds`, so App mounts the focused layer hidden and `EmbeddedTerminal`
  spawns the pty and mints the session id) while `viewMode`, `focusedTerminalId` and the active
  workspace stay EXACTLY as the operator left them: the card appears in the TEMPLATE's workspace and
  they open it when they choose. An external create must never yank someone out of the session they
  are typing in. **The
  prompt is NEVER the caller's**: it is the template's own `initialPrompt` with `$1..$n` filled from
  `args` (`src/shared/prompt/expand.ts`), each value held to that param's `maxLength` and its
  ANCHORED regex (`compileParamPattern`) — a miss is 400 `arg_invalid` naming `args.<i>`, never the
  value. It reaches claude as the POSITIONAL `[prompt]` argument, last in `composeClaudeCommand`.
  **In-app launches do NOT use the prompt in v1** (the field is labelled "Initial prompt (API
  launches)"); `TEMPLATES_FILE_VERSION` stays 1 — `initialPrompt`/`params` are additive `.default()`s.
- **Gate:** the `main-unit` tests drive the REAL server over loopback on an ephemeral port
  (`testSupport.ts`, `port: 0`); the packaged smoke additionally fetches `/docs`, `/openapi.json`
  and `/docs/swagger-ui-bundle.js` (SMOKE forces `{ apiEnabled: true, apiPort: 0 }` at app-ready),
  which is the only check that opens a `swagger-ui-dist` file from inside the package.

### Custom themes (`src/main/themes/`, spec `docs/superpowers/specs/2026-09-20-custom-themes-design.md`)

- **A theme is a folder in `<userData>/themes/<id>/` with a `theme.json`** (`src/shared/schemas/theme.ts`,
  `.strict()`: unknown manifest key, unknown token name or unknown terminal key FAILS THE WHOLE
  THEME closed — a typo is never a silent no-op), an optional CSS file and local assets. Main
  composes ONE stylesheet (`:root` tokens block, then the raw CSS with every `url()` inlined as a
  `data:` URI — allow-listed extensions, 5 MB total) and pushes a `ThemeBundle` over
  `CH.themeApplied`, validated at source. No custom protocol, no file served to the renderer.
- **Fail closed, fall back to Default, KEEP the setting.** `settings.themeId` (additive, v1) is the
  operator's choice; a theme that does not load logs `code=theme_load_failed id=<id> reason=<code>`,
  the DEFAULT bundle is pushed, and Settings shows the error line. Recovery is always "fix or remove
  the folder, Reload themes (or restart)". Logs carry `code=` and the zod `path=` only — never a
  manifest value, CSS text or a file path.
- **`nativeTheme.themeSource` and the root `color-scheme` FOLLOW THE THEME** (`colorScheme: dark|light`,
  `themeLifecycle.ts` + `hooks/useApplyTheme.ts`). The old fixed `:root { color-scheme: dark }` is
  gone from `main.css`; the pre-window `nativeTheme.themeSource = 'dark'` in index.ts is only the
  default before the first apply.
- **Every renderer colour is a token.** `styles/noHexLiterals.test.ts` fails on a hex literal outside
  `tokens.css` / `tokens.ts` / `xtermTheme.ts` / `WorkspaceDot.module.css` / `SmokeCockpit.tsx`. Ink
  on filled buttons is `--text-on-accent` / `--text-on-danger`. `TOKENS` lives in
  `src/shared/theme/tokens.ts` (main validates against it); the renderer path re-exports it.
- **xterm re-themes live, but `allowTransparency` is read at creation only** (xterm requires it
  before `open()`); Settings says so while the applied theme sets it.
- **The SDK is generated and drift-tested:** `docs/themes/THEMES.md` (token table from
  `TOKEN_DOCS`), `docs/themes/theme.schema.json` (`z.toJSONSchema`), `examples/builtin-dark`
  (asserted equal to `TOKENS` + `xtermTheme`). Regenerate with `npm run gen:theme-docs`; the test
  fails while the committed files differ. Rescan is on start, on Settings open and on `Reload
  themes` — there is no file watcher (IdeasBoard).

### node-pty + packaging (a day-costing gotcha)

node-pty is a native module. Keep it EXTERNALIZED in the electron-vite main config, rebuilt
against Electron's ABI via `@electron/rebuild` (`postinstall`), and `asarUnpack`-ed by
electron-builder. `npm run smoke` (packaged) is the gate that proves this still works.

### Security posture (never weaken)

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. node-pty's power stays
in main, behind the typed preload.

## Enforcement (the feedback harness)

- **Strict TypeScript** is the QA: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. Do NOT
  drop a flag to silence an error — fix the consumer.
- **Hooks** (`.claude/hooks/`, wired in `.claude/settings.json`): a PostToolUse hook runs
  incremental `tsc` + cached `eslint` on each edited `*.ts|*.tsx`; a Stop hook runs `vitest run`.
- **Type-checked ESLint:** `no-floating-promises` + `consistent-type-imports` +
  the authored `no-literal-channels` (fixture-tested in
  `tests/unit/no-literal-channels.rule.test.ts`).
- **The `code-reviewer` subagent** (`.claude/agents/code-reviewer.md`) runs the TS/IPC checks
  (implicit any, literal channels, floating promises, Zod boundary gaps, xterm-in-React,
  never-log-parsed-value). The review convention is a fresh reviewer who re-runs the gate
  first-hand and fault-injects every guard (reverting it must turn a test red).

## Versions (don't bump in passing)

Electron **39** (ABI/modules **140**), zod **4**, zustand **5**, React **19**,
@xterm/xterm **6**, node-pty **1.1**, Vitest **4**.
