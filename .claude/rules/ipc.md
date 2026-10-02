---
paths:
  - 'src/shared/ipc/**'
  - 'src/preload/**'
  - 'src/main/index.ts'
  - 'src/main/ipc/**'
  - 'eslint-rules/**'
---

# Rule: the typed IPC seam

## Canonical example (do this)

```ts
// src/shared/ipc/contract.ts — the ONE registry of channel names + payload types.
export const CH = {
  ptyStart: 'pty:start',
  watchSnapshot: 'watch:snapshot'
  // ...
} as const
export type Channel = (typeof CH)[keyof typeof CH]
export type PtyResizeRequest = { cols: number; rows: number }

// main: ipcMain.handle(CH.smokeConfig, () => ({ ... }))      ✅ CH.* const
// preload: ipcRenderer.invoke(CH.settingsGet)                ✅ CH.* const
// NEVER: ipcMain.on('pty:start', ...)                        ❌ string literal
```

## The rule

Every IPC channel name is a `CH.*` member from `src/shared/ipc/contract.ts`. A raw
string literal, a runtime-built string (`'pty'+':'+x`, `` `pty:${x}` ``), or a
computed channel at an `ipcMain`/`ipcRenderer` call site is **banned** and reported
by the authored `local-ipc/no-literal-channels` ESLint rule
(`eslint-rules/no-literal-channels.js`, fixture-tested in
`tests/unit/no-literal-channels.rule.test.ts`).

Why: the main ↔ renderer seam is the app's most error-prone boundary. Centralizing
channel names + payload types makes the seam compiler-enforced and drift-resistant —
rename a channel in one place and every call site moves with it.

## Adding a NEW IPC channel — the ordered recipe (4 files in lockstep)

1. **`src/shared/ipc/contract.ts`** — add the channel to `CH` and define its
   PascalCase payload type(s) (camelCase fields; `invoke` returns the value
   directly, NO `{ data, error }` wrapper; events are discriminated unions on `type`).
2. **`src/shared/schemas/*.ts`** — if the channel carries EXTERNAL/cross-process
   input, add (or reuse) a Zod schema for it. Cross-process args are untrusted.
3. **`src/main/index.ts`** (or the relevant main module) —
   `ipcMain.handle(CH.x, (e, raw) => { const arg = XSchema.parse(raw); ... })`.
   Parse-and-throw-typed on bad input (see `.claude/rules/zod-boundaries.md`).
4. **`src/preload/index.ts`** — expose a typed wrapper through `contextBridge`
   (`ipcRenderer.invoke(CH.x, payload)`); the renderer calls `window.<api>.x(...)`,
   never `ipcRenderer` directly. Update `src/preload/index.d.ts` (`Window` augment).
5. **Test it** — a unit test for the payload schema / handler logic (Vitest, the
   `main-unit` node project for main-side logic). Byte-transport over `MessagePort`
   is packaged-smoke-only (no `MessagePortMain` in jsdom).

## Conventions

- Channels are lowercase `domain:action` strings.
- Payload types: PascalCase, NO `I` prefix, camelCase fields.
- `AttentionEvent` is a FROZEN discriminated union (`session.updated` /
  `session.removed` / `attention.raised`) — Epic-2's consumer relies on it; do not
  reshape it casually.
