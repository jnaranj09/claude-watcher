// Story 3.1 (FR-10) — Zod schemas for the cross-process terminal IPC args.
//
// These guard the renderer→main terminal-lifecycle channels (terminal:open / :resize /
// :stop). Cross-process IPC args are UNTRUSTED → the main handler does `Schema.parse(raw)`
// → THROW typed on bad input (zod-boundaries.md IPC-arg row). This is where the deferred
// "PTY/smoke IPC receive-boundary Zod validation" lands (deferred-work.md): the upgraded,
// flow-controlled MessagePort transport validates its IPC control args at the boundary.
//
// This is OUR shape (not c9watch's), so the fail-closed posture mirrors `settings.ts`,
// NOT `session.ts`: NO `.passthrough()` — an unknown/malformed arg fails closed. `terminalId`
// is the OPAQUE per-terminal id (NOT the session id, NOT a pid — F6): a non-empty string.
// cols/rows are positive integers bounded to a sane terminal range so a malformed/hostile
// resize can never drive a pathological PTY size.
//
// NEVER-LOG-THE-VALUE (Guardrail #6): a ZodError stringifies its INPUT. The terminal args
// carry no session content (an opaque id + two integers), but the rule is uniform — the
// throw IS the boundary signal; callers log PATH + CODE only, never the value.
// [Source: story 3.1 Task 2.2; .claude/rules/zod-boundaries.md; src/shared/schemas/settings.ts
//  (our-shape fail-closed precedent); deferred-work.md (PTY receive-boundary item)]
import { z } from 'zod'

/** Terminal dimension bounds (cols/rows). A terminal smaller than 1×1 is nonsensical; the
 *  upper bound is a generous ceiling that still rejects a hostile/overflow resize. */
export const TERMINAL_MIN_DIM = 1
export const TERMINAL_MAX_DIM = 1000

/** The opaque per-terminal id — a non-empty string (blank fails closed, mirroring
 *  SessionSchema's `id`). NEVER the session id and NEVER a pid (F6). */
const TerminalIdSchema = z.string().min(1)

/** `terminal:open` arg — `{ terminalId, openToken }`. Story 5.4 adds `openToken`: a per-OPEN
 *  token (non-empty string) main echoes back on the port transfer so the renderer pairs THIS port
 *  to THIS open. Fails closed (a missing/blank token throws — the renderer always sends one). */
export const TerminalOpenSchema = z.object({
  terminalId: TerminalIdSchema,
  openToken: z.string().min(1)
})

/** `terminal:resize` arg — `{ terminalId, cols, rows }`; cols/rows are positive
 *  integers in [MIN, MAX]; out of range FAILS CLOSED (throws). */
export const TerminalResizeSchema = z.object({
  terminalId: TerminalIdSchema,
  cols: z.number().int().min(TERMINAL_MIN_DIM).max(TERMINAL_MAX_DIM),
  rows: z.number().int().min(TERMINAL_MIN_DIM).max(TERMINAL_MAX_DIM)
})

/** `terminal:stop` arg — `{ terminalId, openToken? }`.
 *  Story 5.6 — the optional `openToken` lets a stale StrictMode cleanup-stop self-identify
 *  and be no-op'd by the manager (the stored token will have been updated by the re-open).
 *  Omitting it (user-initiated / force-stop) is still valid and results in an unconditional kill. */
export const TerminalStopSchema = z.object({
  terminalId: TerminalIdSchema,
  openToken: z.string().min(1).optional()
})

/** `shell:open` arg — `{ parentTerminalId }`. Strict: the renderer sends ONLY the parent's
 *  terminal id; the cwd is main's own recipe (never an IPC argument). Blank fails closed. */
export const ShellOpenSchema = z
  .object({
    parentTerminalId: TerminalIdSchema
  })
  .strict()

/** `terminal:exit` push — validate-at-source before main → renderer send (a malformed
 *  exit event never crosses the seam). exitCode is an integer. */
export const TerminalExitSchema = z.object({
  terminalId: TerminalIdSchema,
  exitCode: z.number().int(),
  /** UX-10 — the signal that ended the process; absent on a plain exit (0 never crosses). */
  signal: z.number().int().min(1).optional()
})

/**
 * The MessagePort RENDERER→MAIN byte-protocol message (the discriminated union the renderer
 * posts over the transferred port: a keystroke `input` or a flow-control `ack`). The port is a
 * CROSS-PROCESS boundary over `MessagePortMain`, so a message arriving there is UNTRUSTED —
 * the manager `safeParse`s each one and DROPS a malformed message (log path/code only). This is
 * the deferred "PTY receive-boundary Zod validation" (deferred-work.md) on the byte path: a
 * message with an unknown `type` (or a missing `data` on an `input`) must NOT silently fall
 * through to the `ack` branch and drain flow control. Fails closed (no `.passthrough()`).
 * [Source: code-review M-1; .claude/rules/zod-boundaries.md; deferred-work.md]
 */
export const TerminalPortRendererMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string() }),
  z.object({ type: z.literal('ack') })
])
