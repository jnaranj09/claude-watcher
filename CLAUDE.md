# CLAUDE.md

claude-watcher: KDE-first Electron app that watches local `claude` sessions and embeds live
terminals for them. v1 (Epics 0–5) done; Epic 6 replaced the external `c9watch` CLI with a native
session engine (several dir/channel names keep the historical `c9watch` prefix).

`IdeasBoard.md` tracks new work. Remove an item when it is done or discarded. Never implement an
item right away: validate it with a systematic approach (bmad / superpowers), then implement the
same way.

**Designing, speccing, planning or choosing without the owner?** Read `technical-taste.md` first:
how the owner decides, default answers, reversed decisions not to revive, when to stop. A spec
names the sections it applied on its `Taste:` line (hook-checked). Unattended runs decide by it
and tag their own picks `[AGENT]` in the spec.

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
  `themes/`, `ipc/` (trusted wrapper + every `register*Ipc`), `window/` (`createWindow`, the
  per-window watch feed). `index.ts` is app lifecycle and wiring only. Main is the **single source
  of truth for session state**.
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
   **Same thing, same word:** reuse the app's existing word for a thing (`copy/terms.ts`, spec
   `## Copy` table; technical-taste §4).
7. **Maintainability** (`rules/maintainability.md`): nothing stale survives; `npm run find-name`.

**Debugging?** Read `rules/troubleshooting.md` first (Step-0 questions before theorizing).

## Native session engine

Hooks own every status transition; identity is minted at launch (`--session-id`), never `pid`;
every exit is archived or deleted with a reason; min claude version is checked at launch. Full
rules: `.claude/rules/session-engine.md` (loads with `src/main/` engine files; read it before
touching hooks, pty, lifecycle, past sessions or `/clear` rebind).

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
- `Template`/`Shortcut`: `workspaceId` `.nullable().default(null)` (null = global); `favorite`
  `.default(false)`, set only by `CH.*SetFavorite`. `TEMPLATES_FILE_VERSION = 1`,
  `SHORTCUTS_FILE_VERSION = 3` (v2→v3: `parseShortcutsFile`). **Unmigrated bump wipes the store.**
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

Theme = `theme.json` (`.strict()`) + CSS + assets, composed by main into one stylesheet; bundled
Liquid Glass and Paper are read-only; a bad theme fails closed to Default. A theme's optional
`glass` key turns on the WebGL board glass (`renderer/src/glass/`; CSS stays the fallback under
`data-glass-on`). Full rules: `.claude/rules/themes.md`.

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

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Every main IPC listener goes
through `ipc` (`createRendererIpc`, `ipc/trustedIpc.ts`): only the app's own renderer top frame is
answered; only `index.ts` may import `ipcMain` (guard). Exception: electron-store registers its own
`electron-store-get-data` listener (unreachable: the preload exposes no `sendSync`). Packaged fuses:
no RunAsNode / NODE_OPTIONS / `--inspect`, asar-only (`electron-builder.yml`). **Smoke channels
exist only under `C9_SMOKE=1`** (`smoke/smokeIpc.ts`, SEC-8): `CH.ptyStart`/`ptyInput`/`ptyResize`/
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
- ESLint: `no-floating-promises`, `consistent-type-imports`, `no-literal-channels`,
  `switch-exhaustiveness-check`. `npm run lint` also runs knip (dead code, `knip.json`) and jscpd
  (duplication ≤ 0.5%, `.jscpd.json`).
- Guard tests in `tests/main/`: layers, comment-only `catch` allow-list, per-file `as` budget
  (both lists only shrink). `.only` fails Vitest and Playwright.
- `code-reviewer` subagent: fresh reviewer re-runs the gate and fault-injects every guard
  (reverting it must turn a test red).

## Versions (don't bump in passing)

Electron **44** (ABI 149), zod 4, zustand 5, React 19, @xterm/xterm 6, node-pty 1.1, Vitest 4.
Electron 44 notes: `npm install` doesn't download the binary (first run or
`npx install-electron --no`); a new major needs a `node-abi` that knows it; main `clipboard` is
async; Playwright `firstWindow()` resolves before `loadFile` — wait for the page first.
