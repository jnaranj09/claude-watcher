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

/** The operator-typed session name's max length. A name is a board-card title + an attention-rail
 *  row label, not free-form prose — 60 chars is well past what those surfaces can show (both
 *  ellipsize) while still bounding what crosses the IPC seam. Mirrors the exported-constant
 *  convention of `terminal.ts` (TERMINAL_MIN_DIM/MAX_DIM) so tests assert the boundary by name. */
export const SESSION_NAME_MAX_LENGTH = 60

/**
 * True when `value` contains a C0 control char, DEL, or a C1 control char.
 *
 * Written as a code-point scan rather than a regex character class: a class holding literal
 * control characters trips eslint's `no-control-regex` AND is invisible in a diff, so a reviewer
 * cannot see what it matches. The bounds here are explicit and readable.
 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true
  }
  return false
}

/**
 * The OPERATOR-TYPED session name (the create-time prompt; the rename flow will reuse this).
 *
 * `.trim()` runs BEFORE the length checks, so both bounds apply to the TRIMMED value: a
 * whitespace-only name fails `min(1)` rather than being stored as blank, and a padded name is
 * stored tidy. This is the ONE definition of "a legal session name" — do not re-declare the
 * bounds at another call site.
 *
 * NEVER-LOG-THE-VALUE: a ZodError stringifies its INPUT. An operator-typed name can carry
 * whatever the operator considers meaningful (a client name, a ticket id), so callers log the
 * issue PATH + CODE only — never the value. The throw IS the boundary signal.
 */
export const SessionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SESSION_NAME_MAX_LENGTH)
  // No CONTROL characters (C0 + DEL + C1). `trim()` only strips the EDGES, so an interior newline
  // or an ANSI escape would otherwise survive into `sessionName` — which is rendered on the board
  // card, the rail row, the Stop-confirm title and the OS notification title, all of which assume
  // a single-line string. An `<input type="text">` cannot produce these, but this schema is the
  // boundary for an UNTRUSTED renderer, so it must not rely on the widget.
  //
  // Checked by CODE POINT, not by a character class holding literal control chars: eslint's
  // `no-control-regex` forbids the latter, and such a literal is invisible to a code reviewer.
  .refine((name) => !hasControlChar(name), {
    error: 'must not contain control characters'
  })

/** `session:launch` arg — `{ cwd, name }`. `cwd` is a non-empty string (blank fails closed);
 *  `name` is the operator-typed label from the create-time prompt (trimmed, 1..60 — see
 *  SessionNameSchema). NO `.passthrough()` — an unknown/malformed arg fails closed (our shape,
 *  not c9watch's). Both fields are NEVER logged (a path leaks the filesystem layout; a name is
 *  operator content). */
export const SessionLaunchSchema = z.object({
  cwd: z.string().min(1),
  name: SessionNameSchema
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
