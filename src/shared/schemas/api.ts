// Programmatic API — the shared request/response schemas (spec §7).
//
// These are OUR shapes, so the posture mirrors `launch.ts` / `settings.ts`, NOT `session.ts`:
// every object is `.strict()` and there is no `.passthrough()` anywhere. The API validates
// EVERY request (path params, query, body) and EVERY response (validate-at-source, before it
// is written) against these objects, and generates its OpenAPI document from the same ones
// via zod 4's `z.toJSONSchema` — so the document and the gate cannot drift.
//
// WHY STRICT, not passthrough: `hookEvent.ts` is `.passthrough()` because claude owns that
// wire and may ADD keys. Nobody adds keys to this wire but us. An unknown key in a request is
// a caller bug the API must report as `invalid_request`, and an unknown key in a RESPONSE is
// how content leaks: `ApiSessionSchema` is a STATE-ONLY projection of a board session, and
// dropping `.strict()` would let `firstPrompt` / `latestMessage` / `pendingToolInput` ride
// out to an HTTP client. The session's prompts, assistant prose and tool INPUT never reach
// the wire; `pendingToolName` (a tool's NAME, e.g. `Bash`) is the one pending-tool field that
// does, because it is state, not content.
//
// NEVER-LOG-THE-PARSED-VALUE: a ZodError stringifies its INPUT. A create body carries an
// operator-typed `name`, and a session projection carries a `projectPath` (the operator's
// filesystem layout). Consumers of these schemas log the issue PATH + CODE only — never the
// error, never the body. `ApiErrorBodySchema` is deliberately shaped to make that easy to
// honour: `{ code, path? }` and NOTHING else — there is no `message`/`detail` slot for a
// parsed value to be echoed back into.
// [.claude/rules/zod-boundaries.md; src/shared/schemas/launch.ts (our-shape fail-closed)]
import { z } from 'zod'
import { SessionNameSchema } from './launch'
import { EFFORT_LEVELS, PERMISSION_MODES } from './template'
import { WORKSPACE_COLORS } from './workspace'
import { COLUMNS } from '../ipc/contract'

/**
 * Every error code the API can return. ENUM-LOCKED on purpose — this is the opposite call to
 * `status` / `hook_event_name` (which must not fail closed on a string claude invents), because
 * WE mint every one of these. A client switches on the code, so a typo'd or drifted code must
 * fail the response's validate-at-source check rather than reach the wire.
 *
 * The code is the ONLY machine-readable part of an error: it names the CONDITION, never the
 * value that tripped it.
 */
export const API_ERROR_CODES = [
  'unauthorized',
  'invalid_json',
  'body_too_large',
  'invalid_request',
  'arg_invalid',
  'template_has_no_prompt',
  'prompt_too_long',
  'template_workspace_gone',
  'folder_missing',
  'not_found',
  'template_not_found',
  'workspace_not_found',
  'session_not_found',
  'method_not_allowed',
  'claude_version',
  'no_window',
  'too_many_streams',
  'spawn_timeout',
  'internal'
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/**
 * The ONE error body every failing response uses: `{ error: { code, path? } }`.
 *
 * `path` is the Zod issue PATH (e.g. `name`, `args.0`) — the field that failed, never the value
 * that failed it. Both objects are `.strict()`, so no handler can grow a `message` field holding
 * a ZodError's stringified input; the never-log-the-value rule is enforced by the shape itself.
 */
export const ApiErrorBodySchema = z
  .object({
    error: z.object({ code: z.enum(API_ERROR_CODES), path: z.string().optional() }).strict()
  })
  .strict()
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>

/**
 * The wire projection of a board session — STATE ONLY (spec §7).
 *
 * This is a narrower shape than the reducer's `Session` (`session.ts`) and than the enriched
 * delta the renderer gets (`watchDelta.ts`): it carries identity, status, board position,
 * scope and the pending tool's NAME. It deliberately does NOT carry `firstPrompt`,
 * `latestMessage`, `messageCount`, `pendingToolInput` or `pid`. `.strict()` is what makes that
 * a guarantee rather than an intention — a caller (or a future enrich step) that hands a
 * content field to this schema gets a parse failure, not a leak.
 *
 * `status` is NOT enum-locked (a new status string must not fail a session closed), but
 * `column` IS: it is the board's own three-way classification, derived from the same `COLUMNS`
 * list the shared `Column` union and the enriched delta use, so a fourth column cannot appear
 * in one and not the others.
 */
export const ApiSessionSchema = z
  .object({
    id: z.string().min(1),
    sessionName: z.string(),
    status: z.string(),
    column: z.enum(COLUMNS),
    enteredColumnAt: z.number(),
    workspaceId: z.string().min(1),
    tagIds: z.array(z.string().min(1)),
    projectPath: z.string(),
    /** The pending tool's NAME (`Bash`, `Agent`, …) — state. Its INPUT is content and is not
     *  projected here at all. */
    pendingToolName: z.string().optional(),
    /** Name-sync — true while an in-app rename waits for claude's next prompt. State, not
     *  content. Absent = false. */
    nameSyncPending: z.boolean().optional()
  })
  .strict()
export type ApiSession = z.infer<typeof ApiSessionSchema>

/** SSE `session.removed` data — the card is gone. The LAST frame of that id's stream. */
export const ApiSessionRemovedSchema = z.object({ id: z.string().min(1) }).strict()
export type ApiSessionRemoved = z.infer<typeof ApiSessionRemovedSchema>

/**
 * SSE `session.rebound` data (R8). claude changed the session's id mid-run (`/clear`) and the card
 * followed it: `id` is the id this stream was opened on, `newId` the one the card has now. It is
 * the LAST frame of that stream — the client re-subscribes to `newId`. STATE only: two uuids.
 */
export const ApiSessionReboundSchema = z
  .object({ id: z.string().min(1), newId: z.string().min(1) })
  .strict()
export type ApiSessionRebound = z.infer<typeof ApiSessionReboundSchema>

/** `GET /sessions` output — an array of the state-only projection. A bad member fails the whole
 *  response closed (validate-at-source: ship nothing rather than ship garbage). */
export const ApiSessionListSchema = z.array(ApiSessionSchema)

/**
 * `POST /sessions` body.
 *
 * `name` REUSES `SessionNameSchema`, so an API-created session and an in-app created one agree
 * by construction on what a legal name is (trimmed, 1..60, no control characters) — the API
 * cannot become a side door for a name the UI would refuse.
 *
 * `args` defaults to `[]`, so a caller with a no-placeholder template may omit it. The members
 * are shape-checked as strings only; the per-arg CONTENT rules are the `arg_invalid` gate
 * further in, not a shape concern.
 */
export const SessionsCreateBodySchema = z
  .object({
    templateId: z.string().min(1),
    name: SessionNameSchema,
    args: z.array(z.string()).default([])
  })
  .strict()
export type SessionsCreateBody = z.infer<typeof SessionsCreateBodySchema>

/** `POST /sessions` output — the three ids the caller needs to follow the session it just
 *  created. Validated at source before it is written. */
export const SessionsCreateOutputSchema = z
  .object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    workspaceId: z.string().min(1)
  })
  .strict()
export type SessionsCreateOutput = z.infer<typeof SessionsCreateOutputSchema>

/** The `/sessions/{id}` path param. Non-empty only — an id that is merely UNKNOWN must reach
 *  the handler and take the `session_not_found` path, not fail at the shape gate (the same
 *  call `SessionRenameSchema` makes). */
export const SessionIdParamsSchema = z.object({ id: z.string().min(1) }).strict()

/** The `GET /sessions` query. `workspaceId` is optional (absent = every workspace) but must be
 *  non-empty when present: `?workspaceId=` is a caller bug, not "all". */
export const SessionsListQuerySchema = z
  .object({ workspaceId: z.string().min(1).optional() })
  .strict()

/** The shape of a request with no params/query/body and of a response with no content. Named so
 *  a route always declares all four slots explicitly — an omitted slot would read as "unchecked",
 *  and `EmptySchema` reads as "checked, and must be empty". */
export const EmptySchema = z.object({}).strict()

/**
 * `GET /workspaces` — one workspace as the API shows it: id, name, color, and whether it is the
 * one the operator is looking at. `active` is what a caller needs to predict where a GLOBAL
 * template's session lands (`POST /sessions` puts it in the active workspace).
 *
 * `defaultCwd` is deliberately NOT here: it is a folder-picker convenience, not something a
 * caller acts on. `.strict()` keeps it that way.
 */
export const ApiWorkspaceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    color: z.enum(WORKSPACE_COLORS),
    active: z.boolean()
  })
  .strict()
export type ApiWorkspace = z.infer<typeof ApiWorkspaceSchema>
export const ApiWorkspaceListSchema = z.array(ApiWorkspaceSchema)

/** One `$n` placeholder of a template, as stored: the caller needs `pattern` and `maxLength` to
 *  build `args` the create will accept (the pattern is anchored by the server, not here). */
export const ApiTemplateParamSchema = z
  .object({ label: z.string(), pattern: z.string(), maxLength: z.number().int() })
  .strict()

/**
 * `GET /templates` — the WHOLE template, `initialPrompt` included. This is the one place the API
 * sends prose: a template is the operator's own CONFIG, readable by the same token that can
 * already run it. Session content (prompts sent, assistant prose, tool input) still never
 * reaches the wire — that is `ApiSessionSchema`'s job, and it is unchanged.
 *
 * Plain types rather than a reuse of `TemplateSchema`: that one trims, refines and defaults —
 * rules for WRITING a template. This is a response shape, `.strict()` like every other one here,
 * so a field added to `Template` fails the response closed instead of riding out unreviewed.
 */
export const ApiTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    cwd: z.string(),
    model: z.string().nullable(),
    permissionMode: z.enum(PERMISSION_MODES).nullable(),
    effort: z.enum(EFFORT_LEVELS).nullable(),
    /** null ⇒ GLOBAL (a create lands in the active workspace). */
    workspaceId: z.string().min(1).nullable(),
    /** null ⇒ the template cannot be launched through the API (`template_has_no_prompt`). */
    initialPrompt: z.string().nullable(),
    params: z.array(ApiTemplateParamSchema)
  })
  .strict()
export type ApiTemplate = z.infer<typeof ApiTemplateSchema>
export const ApiTemplateListSchema = z.array(ApiTemplateSchema)

/** The `scope` value that means "templates in no workspace". A WORD, never `''` (an empty scope
 *  is a caller bug, not a filter). It cannot collide with a workspace id: those are minted UUIDs
 *  and the fixed `default`. */
export const TEMPLATE_SCOPE_GLOBAL = 'global'

/** The `GET /templates` query. Absent = every template; present = STRICT, like the Manage
 *  dialog's scope filter — a workspace scope does NOT pull in the global templates. */
export const TemplatesListQuerySchema = z
  .object({
    scope: z
      .string()
      .min(1)
      .optional()
      .describe(
        "`global` for the templates in no workspace, or a workspace id for that workspace's " +
          'templates only (global ones are not included). Omit it for every template.'
      )
  })
  .strict()
