# Rule: the programmatic API (`src/main/api/`)

Second localhost listener (beside the :9279 hook ingest) so external systems (n8n, another claude,
a webhook) can create a card and watch it. OFF by default (`settings.apiEnabled`), binds
`127.0.0.1:apiPort` (9281; 9280 is the operator's `kubectl-radar`), bearer token on every `/v1/*`.

**A CONTROL surface, not a content one:** a caller can run a prompt the operator wrote and read
STATE — never prompts, assistant prose or tool input. Config (workspaces, templates incl.
`initialPrompt`) is readable; session content never is.

## Canonical command

```ts
// src/main/api/commands/sessionsGet.ts — one action, one file, one object.
export const sessionsGetCommand = defineCommand({
  id: 'sessions.get',
  method: 'GET',
  path: '/v1/sessions/{id}',
  summary: 'One session card by its stable id',
  params: SessionIdParamsSchema, // all four slots declared; EmptySchema = "checked, must be empty"
  query: EmptySchema,
  body: null,
  output: ApiSessionSchema, // validated at source before writing
  successStatus: 200,
  errorStatuses: [401, 404, 503],
  async handler(ctx, { params }) {
    const seam = ctx.seam()
    if (seam === null) return { ok: false, status: 503, code: 'no_window' }
    const session = seam.getSession(params.id)
    if (session === null) return { ok: false, status: 404, code: 'session_not_found' }
    return { ok: true, status: 200, body: session }
  }
})
```

## Rules

- **The registry IS the API.** Router (`apiServer.ts`) and `/openapi.json` (`openapi.ts`) are both
  generated from `apiCommands` in `commands/index.ts`.
- **A new action = exactly 3 things:** the command file (reuse/add `.strict()` schemas in
  `src/shared/schemas/api.ts`), one entry in `commands/index.ts` (order = doc order only), a
  `main-unit` test driving the REAL server via `testSupport.ts` (`port: 0`). Server, token, docs,
  lifecycle stay untouched. Need context? Add a NARROW field to `ApiContext` (e.g. store `get`,
  never `save` — the API is not a write path into config).
- **Validated once, fails closed:** `params`/`query`/`body` each `safeParse`d; first miss → 400
  `invalid_request` + issue PATH. Response validated against `output`; mismatch → 500, never a write.
- **Errors are `{ error: { code, path? } }` only.** Codes enum-locked (`API_ERROR_CODES`) — we mint
  them. No message slot (nowhere to echo input).
- **Read through `ApiSeam`** (one per window, beside `launchBoardSeams`), fed from inside
  `handleDelta`'s board-ship gate — a session the board doesn't show never reaches a client. No
  window → 503 `no_window`.
- **A create never takes the view:** main pushes `CH.launchRequested`; renderer calls
  `boardStore.registerLaunchedTerminal` (registry only, NOT `openLaunchedTerminal`). Terminal mounts
  hidden and spawns; `viewMode`, `focusedTerminalId`, active workspace untouched. Card lands in the
  TEMPLATE's workspace (global template → active workspace).
- **Prompt is never the caller's:** template `initialPrompt` with `$1..$n` from `args`
  (`shared/prompt/expand.ts`); each value checked against `maxLength` and anchored regex
  (`compileParamPattern`); miss → 400 `arg_invalid` path `args.<i>`. Passed as positional
  `[prompt]`, last in `composeClaudeCommand`. In-app launches don't use it in v1.
- **Create refusal order:** 400s → 409 `folder_missing` (UX-11) → 503 `claude_version` (no desktop
  box; refusal reused 30 s, `createClaudeVersionGate`, R25) → 503 `hooks_unavailable`
  (`ctx.hooksListening()`, SEC-6) → 503 `no_window`.
- **Wire session is STATE ONLY** (`apiSession.ts` → `.strict()` `ApiSessionSchema`): `id`,
  `sessionName`, `status`, `column`, `enteredColumnAt`, `workspaceId`, `tagIds`, `projectPath`,
  `pendingToolName`. A new `Session` field DROPS the frame (`code=session_projection_failed`)
  rather than leaking.
- **Catalog reads** (`GET /v1/workspaces`, `GET /v1/templates`) read stores (no `no_window`), PICK
  fields into `.strict()` `ApiWorkspace` (no `defaultCwd`, adds `active`) / `ApiTemplate`.
  `?scope=` is strict (workspace → its own only; `global` → global only; unknown → 404
  `workspace_not_found`).

## Never log body, values or token

- One line per request: `[claude-watcher][api] method=<M> route=<command.id>` — pattern, never URL.
- Failures: `code=` + Zod `path=` only. Never a `ZodError`, thrown value, or errno message.
- A 401 says nothing else.

## Token

32 random bytes → 64 lowercase hex in `claude-watcher-api-token` (userData), 0600 via `chmodSync`
once per process (on first `current()` that finds an existing file; `current()` caches). Not
exactly 64 hex → replaced. Read through a getter per request (regenerate needs no restart).
Compared with `timingSafeEqual` over sha256 of both sides. First mint is fail-soft (in memory);
`regenerate()` THROWS `token_write_failed` and keeps the old token.

## SSE (`GET /v1/sessions/{id}/events`)

- Every refusal decided BEFORE `sink.start()` (no error slot after headers).
- Frame 1 = SNAPSHOT. `start()` → `onEvent` → `sink.onClose(off)` → snapshot, nothing awaited in
  between (keeps deltas behind the snapshot; avoids a leaked subscription).
- LAST frame = `session.removed {id}` or `session.rebound {id, newId}` (R8, `/clear`), then close.
  Never follow the new id; never send a rebind as removed. `adoptCard` emits rebound before the old
  removal. Both `.strict()`, hoisted (`ApiSessionRemoved`, `ApiSessionRebound`); invalid rebound →
  end with no frame (`code=rebound_frame_invalid`).
- No replay (`Last-Event-ID` ignored). Max 32 streams (`API_SSE_MAX_STREAMS`) → 503
  `too_many_streams`. `: ping` every 15 s. Throwing subscriber contained (`createApiEventHub`
  iterates a copy).

## `/docs` and `/openapi.json` are PUBLIC

Served before the bearer check. OpenAPI 3.1 via `z.toJSONSchema`; request schemas with
`{ io: 'input' }` (so `.default()` fields publish optional). `.trim()`/`.refine()` are lost →
add a description. Swagger UI from `swagger-ui-dist` (`createRequire(__filename)`), a 3-file NAME
allow-list (no path join, no traversal). **Never `persistAuthorization`** (SEC-4, `docs.test.ts`).
`swagger-ui-dist` pinned EXACTLY (5.32.15); **keep `"scarfSettings": { "enabled": false }`** in
`package.json` (telemetry opt-out).

## Lifecycle

`createApiLifecycle` starts/stops from settings: first apply on `did-finish-load`, `stop()` on
`will-quit`. `apply()` is idempotent — never restart on an unrelated patch (drops SSE streams).
Bind errors are async (`onError`): log `code=listen_failed errno=`, drop the entry so the next apply
retries, report `port_in_use`/`failed` → Settings shows the port is taken (R11). (Hook server
instead tolerates EADDRINUSE.)

## Accepted risks (only because the token holder is the operator's own loopback automation)

- **ReDoS on operator `pattern`:** bounded by checking `maxLength ≤ 200` FIRST in `validateArgs`.
  Order count → length → control chars → regex is load-bearing.
- **No rate limit:** each create is a real claude. First thing to add if the token leaves the box.
- **`overrides` map grows per create** (504s too): recipes are what Reopen re-spawns from; fix with
  a rate limit, not by clearing recipes.

## claude's folder-trust gate

On a folder claude has never seen, it waits on "Is this a project you trust?" — create still 201s,
card sits in `Connecting`, prompt never submitted. Templates used by automation must name a folder
already opened in claude once.

## Don't

- Don't accept caller prose (no free-text `prompt` field — that is RCE behind one token).
- Don't run a regex before the length check; don't anchor by hand (`compileParamPattern` compiles
  standalone first — `a)|(.*` escapes naive anchors).
- Don't add a third listener; don't bind `0.0.0.0` or make the host a setting; don't add CORS.
- Don't widen `ApiSession` with content; don't drop `.strict()` from `api.ts` schemas.
- Don't return an unvalidated 200; don't pass `writeError` a runtime value.
