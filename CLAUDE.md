# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

c9watch cockpit is a KDE-first Electron desktop app that watches local `claude` (c9watch)
sessions and embeds live terminals for them. v1 (Epics 0–5) is feature-complete.

## Commands

| Task | Command |
| --- | --- |
| Dev (HMR) | `npm run dev` |
| Build (typecheck + bundle) | `npm run build` |
| Packaged build (`--dir`) | `npm run build:dir` |
| Typecheck (node + web + test projects) | `npm run typecheck` |
| Lint (flat config, type-checked rules) | `npm run lint` |
| Format | `npm run format` |
| Unit/integration tests (Vitest) | `npm run test` |
| Watch tests | `npm run test:watch` |
| E2E (Playwright-Electron) | `npm run test:e2e` |
| Packaged node-pty smoke gate | `npm run smoke` (after `build:dir`, or `npm run smoke:packaged`) |

**Running a single test** — Vitest has two projects (see `vitest.config.ts`): `unit`
(jsdom) and `main-unit` (node). Target one file or test:

```bash
npx vitest run src/main/c9watch/reducer.test.ts          # one file
npx vitest run --project main-unit -t "desync"           # one test by name (main-side)
npx vitest run --project unit src/shared/schemas         # one project / dir
```

**Gate buckets.** Most changes gate on `typecheck / lint / test / build`. Only changes
touching node-pty / the preload seam / packaging additionally require `build:dir` +
`smoke` (the packaged-native gate). The `smoke` script proving node-pty survives
packaging is load-bearing — do not regress it.

## Architecture — three process layers + shared

Code lives in four trees; the boundaries between them are the whole design:

- **`src/main/`** — Electron main process. **node-pty runs HERE, never in the renderer.**
  Subdivided into `c9watch/` (the feed → reducer pipeline), `pty/` (terminal/launch
  lifecycle), `kde/`, `lifecycle/`, `persistence/`. Main is the **single source of truth
  for session state**.
- **`src/preload/`** — the typed `contextBridge` seam. The renderer gets ONLY these
  functions, never `ipcRenderer`/Node directly. `index.d.ts` augments `Window`.
- **`src/renderer/`** — React UI (sandboxed). Reaches IPC only through `window.*` bridges.
  View-state lives in a Zustand store (`src/renderer/src/stores/boardStore.ts`).
- **`src/shared/`** — imported by BOTH sides: `ipc/contract.ts` (the `CH` channel registry
  + payload types) and `schemas/session.ts` (the Zod c9watch adapter).
- `src/__fixtures__/` — the fake c9watch feed (test double; never shipped).

### The data flow (one-way)

```
c9watch NDJSON ──> main: Zod-validate (session.ts) ──> reducer (Map<id,Session>)
   ──> validated deltas over CH.watchEvents ──> renderer Zustand store ──> selectors ──> components
```

Session truth flows main → renderer; view intent flows back via typed IPC. The renderer
never invents or mutates session truth — it renders a projection of what main sends.

## Load-bearing constraints (the non-obvious ones)

Detailed standards live in `.claude/rules/*` — read the relevant file before touching
that layer. The high-frequency rules, in **precedence order** (earlier wins on conflict):

1. **Fail-closed Zod boundaries** (`.claude/rules/zod-boundaries.md`). Every external input
   is validated at exactly ONE boundary that fails closed. A bad `watch` line drops + logs
   **by error PATH + CODE only — never the value** (a ZodError stringifies its input, which
   may carry PTY content / prompts / secrets). A bad `list` snapshot throws → caller backs
   off. This BEATS never-crash.
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

**Debugging a symptom?** Read `.claude/rules/troubleshooting.md` first — run its Step-0
questions (data present? depends on a sibling? console empty?) to pin the layer before
theorizing. Note its trap: the `tests/e2e/two-launch-screenshot*` diagnostics were not
trustworthy and have been removed; a manual repro with real `claude` is the reliable signal.

### c9watch is the hardest external dependency

- ALL c9watch input goes through the Zod adapter in `src/shared/schemas/session.ts`
  (`.passthrough()` so additions pass; known-key malformations fail closed). Never
  hand-parse a c9watch line elsewhere. The adapter is a **parse-once** boundary — do not
  re-validate already-parsed output.
- **Timestamps:** c9watch emits ISO-8601 with a tz offset; the adapter coerces to
  epoch-millis ONCE (`z.iso.datetime({ offset: true })`, fails closed on tz-less). Work in
  epoch-millis internally.
- **Identity = the stable `id` (UUID), never `pid`** — pid is a wandering claude thread id.
  Key/dedup sessions by `id` (a duplicate `id` throws `DuplicateSessionIdError`).
- **`status` is NOT enum-locked** (a new c9watch status must not fail the session closed).
- **`pendingToolInput` is polymorphic** (object for `Agent`, string for others) — do not narrow it.
- The feed runs `c9watch watch --changes-only`, which suppresses all `started` events; a
  session appearing after watch begins arrives as a `status_changed` for an unknown id. The
  reducer **upserts** such a line (heals the DESYNC) rather than dropping it (Story 5.7).

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
