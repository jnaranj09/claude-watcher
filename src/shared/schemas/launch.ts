// Story 3.2 (FR-11) — Zod schema for the in-app launch IPC arg (the picked cwd).
//
// This guards the renderer→main `session:launch` channel. Cross-process IPC args are
// UNTRUSTED → the main handler does `Schema.parse(raw)` → THROW typed on bad input
// (zod-boundaries.md IPC-arg row). The picked directory path arrives from the native
// picker, but it is re-validated HERE at the launch boundary — never trusted as a launch
// arg just because the picker produced it (the renderer round-trips it, and a renderer is
// untrusted cross-process input).
//
// This is OUR shape (not c9watch's), so the fail-closed posture mirrors `settings.ts` /
// `terminal.ts`, NOT `session.ts`: NO `.passthrough()` — an unknown/malformed arg fails
// closed. `cwd` is a non-empty string (a blank cwd fails closed, mirroring SessionSchema's
// `id` and TerminalIdSchema). We do NOT validate that the path EXISTS or is a directory here
// (that is a filesystem check, not a shape check) — a non-existent path simply fails the
// node-pty spawn, which degrades to a dead terminal (never-crash); the shape gate's job is to
// reject a non-string / blank arg at the boundary.
//
// NEVER-LOG-THE-VALUE (Guardrail #6): a ZodError stringifies its INPUT. A directory path
// leaks the operator's filesystem layout, so callers log PATH + CODE only, never the value —
// the throw IS the boundary signal.
// [Source: story 3.2 Task 1.2; .claude/rules/zod-boundaries.md (IPC-arg parse-and-throw,
//  never-log-the-value); src/shared/schemas/terminal.ts / settings.ts (our-shape fail-closed)]
import { z } from 'zod'

/** `session:launch` arg — `{ cwd }`. `cwd` is a non-empty string (blank fails closed). NO
 *  `.passthrough()` — an unknown/malformed arg fails closed (our shape, not c9watch's). */
export const SessionLaunchSchema = z.object({
  cwd: z.string().min(1)
})

export type SessionLaunchArg = z.infer<typeof SessionLaunchSchema>

/**
 * Story 3.4 (FR-16) — validate-AT-SOURCE for the `launch:correlated` push (main → renderer).
 *
 * The launch service emits `{ terminalId, sessionId }` toward the renderer the moment the Tgid
 * correlation join lands; main asserts the shape BEFORE `wc.send` so a malformed binding never
 * crosses the seam (renderer-facing delta = validate at source, zod-boundaries.md). Both fields
 * are non-empty strings (blank fails closed) — `terminalId` is the opaque per-terminal id,
 * `sessionId` is the stable UUID session id (NEVER a pid). Both are opaque identifiers, never
 * session CONTENT, so on a parse miss the caller logs PATH + CODE only (never the value). NO
 * `.passthrough()` — our shape, fail-closed.
 * [Source: story 3.4 Task 1.3; .claude/rules/zod-boundaries.md (main→renderer = validate at source)]
 */
export const LaunchCorrelatedSchema = z.object({
  terminalId: z.string().min(1),
  sessionId: z.string().min(1)
})

export type LaunchCorrelatedArg = z.infer<typeof LaunchCorrelatedSchema>
