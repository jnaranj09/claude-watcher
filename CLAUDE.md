# c9watch cockpit — project guide for AI implementers

A KDE-first Electron desktop cockpit that watches local `claude` (c9watch) sessions
and embeds live terminals. This file is the terse "don't-forget-this-exists" index.
The do-this-exactly rules live in `.claude/rules/*` — read the relevant one before
touching that layer.

## Commands

| Task | Command |
| --- | --- |
| Dev (HMR) | `npm run dev` |
| Build (typecheck + bundle) | `npm run build` |
| Packaged build (`--dir`) | `npm run build:dir` |
| Typecheck (node + web + test) | `npm run typecheck` |
| Lint (flat config, type-checked rules) | `npm run lint` |
| Unit/integration tests (Vitest, 2 projects) | `npm run test` |
| Packaged node-pty smoke gate | `npm run smoke` (after `build:dir`) |

## Where code lives (three layers + shared)

- `src/main/` — Electron main process. node-pty runs HERE (never in the renderer).
- `src/preload/` — the typed `contextBridge` seam. The renderer gets ONLY these
  functions, never `ipcRenderer`/Node directly. `index.d.ts` augments `Window.pty`.
- `src/renderer/` — React UI. Sandboxed. Reaches IPC only through `window.*` bridges.
- `src/shared/` — code imported by BOTH sides: `ipc/contract.ts` (the `CH` channel
  registry + payload types) and `schemas/session.ts` (the Zod c9watch adapter).
- `src/__fixtures__/` — the fake c9watch feed (test double; never shipped).
- `tests/` — `smoke/` (packaged node-pty gate, zero-dep), `unit/` + `main/` (Vitest),
  `e2e/` (Playwright-Electron, Epic-3).

## High-frequency rules (PRECEDENCE order)

When two rules collide, the one EARLIER in this list wins:

1. **fail-closed + typed-error-propagation** — validate every external input at its
   boundary; on bad input, drop+log-by-PATH (never the value) or throw a typed
   error. This BEATS "never-crash": a silent wrong state is worse than a handled
   failure. → `.claude/rules/zod-boundaries.md`
2. **never-crash** — past the validated boundary, degrade gracefully; one bad
   session/line must not take down the board.
3. **typed IPC seam** — every channel is a `CH.*` const from
   `src/shared/ipc/contract.ts`, NEVER a string literal (enforced by the
   `no-literal-channels` ESLint rule). → `.claude/rules/ipc.md`
4. **xterm owned imperatively** — terminals live in refs, NEVER React `useState`;
   they are NOT in the store. → `.claude/rules/terminal.md`
5. **state ownership** — session-truth = main (from c9watch); view-state = renderer
   Zustand; derived = selectors. → `.claude/rules/state.md`

## Debugging a symptom? Characterize before you theorize

Before reading code or fanning out subagents on ANY bug, run the three Step-0 questions
(data present? depends on a sibling? console empty?) — they pin the layer in under a
minute and stop you chasing the wrong one. → `.claude/rules/troubleshooting.md`
(symptom→layer table, cheap kill-tests, and the not-trustworthy `two-launch-screenshot`
diagnostics trap).

## Load-bearing gotchas (the ones that cost a day if forgotten)

- **node-pty + packaging:** node-pty is a native module. Keep it EXTERNALIZED in the
  electron-vite main config, rebuilt against Electron's ABI via `@electron/rebuild`
  (`postinstall`), and `asarUnpack`-ed by electron-builder. The packaged smoke
  (`npm run smoke`) is the gate that proves this still works — do NOT regress it.
- **Security posture (NEVER weaken):** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`. node-pty's power stays in main, behind the typed preload.
- **c9watch is the hardest external dependency** — its JSON schema can drift. ALL
  c9watch input goes through the Zod adapter in `src/shared/schemas/session.ts`
  (`.passthrough()` so additions pass; known-key malformations fail closed). Never
  hand-parse a c9watch line elsewhere.
- **Timestamps:** c9watch emits ISO-8601 with a tz offset; the adapter coerces to
  epoch-millis ONCE (`z.iso.datetime({ offset: true })`, fails closed on tz-less).
  Work in epoch-millis internally.
- **Identity = the stable `id` (UUID), never `pid`** — pid is a wandering claude
  thread id. Key/dedup sessions by `id`.
- **`pendingToolInput` is POLYMORPHIC** — object for `Agent`, string for `Question`/
  others. The schema accepts both; do not narrow it.

## Enforcement (the feedback harness)

- **Strict TypeScript** is the agent's QA: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noImplicitAny`. Do NOT drop a flag to silence an error — fix the consumer.
- **Hooks** (`.claude/hooks/typecheck-lint.sh`, wired in `.claude/settings.json`):
  a PostToolUse hook runs incremental `tsc` + cached `eslint` on each edited
  `*.ts|*.tsx`; a Stop hook runs `vitest run`. (See `.claude/settings.json` — if it
  is absent, create it from the example in that task's notes; it is the project
  harness, checked into git, separate from machine-local `settings.local.json`.)
- **Type-checked ESLint:** `no-floating-promises` + `consistent-type-imports` +
  `no-literal-channels` (fixture-tested in `tests/unit/no-literal-channels.rule.test.ts`).
- **The code-reviewer subagent** (`.claude/agents/code-reviewer.md`) runs the
  TS/IPC-specific checks (implicit any, literal channels, floating promises, Zod
  boundary gaps, xterm-in-React, never-log-parsed-value).

## Facts that won't change soon

- Electron **39.8.10** (ABI/modules **140**). Do NOT "upgrade" to 40/42 in passing.
- Zustand is NOT installed yet (Epic 1). `.claude/rules/state.md` is the standard the
  Epic-1 store MUST follow, not a description of existing code.
