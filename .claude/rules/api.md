# Rule: the programmatic API (`src/main/api/`)

A SECOND localhost listener, beside the :9279 hook ingest, so an external system (n8n, another
claude session, a ticket webhook) can create a card and watch it move. It is OFF by default
(`settings.apiEnabled`), binds 127.0.0.1:`apiPort` (9281), and every `/v1/*` request carries a
bearer token.

It is a CONTROL surface, not a content one. The two halves of that sentence are the whole design:
a caller can run a prompt the operator already wrote, and it can read STATE about the sessions the
board shows — never the prompts, the assistant's prose or a tool's input.

It can also read the operator's CONFIG: the workspaces and the templates, whole — a template's
`initialPrompt` included, because it is the prompt a create would run and the token can already
run it. Config is readable; SESSION content never is.

## Canonical example (do this)

```ts
// src/main/api/commands/sessionsGet.ts — ONE action, one file, one object.
export const sessionsGetCommand = defineCommand({
  id: 'sessions.get',
  method: 'GET',
  path: '/v1/sessions/{id}', // `{name}` segments become `params`
  summary: 'One session card by its stable id',
  params: SessionIdParamsSchema, // ← the four schemas are SEPARATE and all four are declared;
  query: EmptySchema, //            `EmptySchema` reads as "checked, and must be empty",
  body: null, //                    an omitted slot would read as "unchecked"
  output: ApiSessionSchema, // validated AT SOURCE before the response is written
  successStatus: 200,
  errorStatuses: [401, 404, 503], // the OpenAPI document's error rows
  async handler(ctx, { params }) {
    const seam = ctx.seam()
    if (seam === null) return { ok: false, status: 503, code: 'no_window' }
    const session = seam.getSession(params.id)
    if (session === null) return { ok: false, status: 404, code: 'session_not_found' }
    return { ok: true, status: 200, body: session }
  }
})
```

## The rule

**The registry IS the API.** `commands/index.ts` exports the ordered `apiCommands` list; the router
(`apiServer.ts`) and the OpenAPI document (`openapi.ts`) are BOTH generated from it. A route with no
documented command is impossible, and an operation nobody serves cannot be written by hand.

**Adding an action is exactly three things** — and touching a fourth means you are doing it wrong:

1. `src/main/api/commands/<name>.ts` — one `defineCommand` object. Reuse a schema from
   `src/shared/schemas/api.ts` where one fits (a hoisted schema becomes a `$ref` and a generated
   client gets ONE type for it); add it there, `.strict()`, when it does not.
2. one entry in `commands/index.ts`. Order = the order in the OpenAPI document ONLY — the router
   matches the path and then the method, so `GET` and `POST` on one path cannot shadow each other.
3. a test in the `main-unit` project. `testSupport.ts` holds the doubles and starts the REAL server
   on an ephemeral port (`port: 0`); drive it over loopback, not by calling the handler.

The server, the token, the docs and the lifecycle stay untouched. If your action needs a new field
on `ApiContext`, add it there (narrow on purpose: a command gets `get` on the template store, not
`save` — the API is not a second write path into the operator's own config).

**Every request is validated ONCE, by that command's own schemas, and fails closed**
(`.claude/rules/zod-boundaries.md`). `params`, `query` and `body` are each `safeParse`d in the
router; the first failure is 400 `invalid_request` carrying the issue PATH. Every RESPONSE is
validated at source against `output` before it is written — a body that does not match the document
is a 500, never a write.

**Errors are `{ error: { code, path? } }` and NOTHING else.** The codes are ENUM-LOCKED
(`API_ERROR_CODES`) — the opposite call to `status` / `hook_event_name`, because WE mint every one
of them and a client switches on the code. The body has no `message`/`detail` slot on purpose:
there is nowhere for a parsed value to be echoed back into.

**The API reads main's truth through `ApiSeam`, never around it.** One seam per window, registered
beside `launchBoardSeams`. Its event side is fed from INSIDE `handleDelta`'s board-ship gate, so the
board and the SSE streams cannot diverge: a session the board never shows never reaches a client.
No window ⇒ `no_window` (503, retryable), never an invented empty board.

**A create NEVER takes the operator's view.** Main pushes `CH.launchRequested` exactly as before, but
the renderer's listener calls `boardStore.registerLaunchedTerminal` — registry ONLY — and not the
`+ New session` popover's `openLaunchedTerminal`. The terminal still mounts and still spawns its pty
(the registry key keeps it in `selectKeptAliveTerminalIds`, which is what mounts App's focused layer,
hidden), while `viewMode`, `focusedTerminalId` and the active workspace are left untouched: the card
appears in the TEMPLATE's workspace and the operator opens it when they choose. An external caller
must not be able to yank someone out of the session they are typing in.

**The wire session is STATE ONLY** (`apiSession.ts` → `.strict()` `ApiSessionSchema`): `id`,
`sessionName`, `status`, `column`, `enteredColumnAt`, `workspaceId`, `tagIds`, `projectPath` and
`pendingToolName` (a tool's
NAME is state; its INPUT is content and is not projected at all). Strict is what makes that a
guarantee instead of a habit — add a field to `Session` and the projection DROPS
(`code=session_projection_failed`) rather than leaking it.

**The catalog reads** (`GET /v1/workspaces`, `GET /v1/templates`) read the stores, not the seam, so
they answer with or without a window (no `no_window`). Both PICK their fields into a `.strict()`
shape (`ApiWorkspace`, `ApiTemplate`) — a spread would fail closed the day `Workspace`/`Template`
gains a field. `ApiWorkspace` drops `defaultCwd` and adds `active` (where a GLOBAL template's
create lands). `?scope=` is STRICT like the Manage dialog's filter: a workspace id returns its own
templates only, never the global ones (a global template created through the API lands in the
ACTIVE workspace, not the filtered one); `global` returns the global ones; an unknown id is 404
`workspace_not_found`, not `[]`.

## Never log the body, the values, or the token

Same rule as every other boundary here, with three extra things in scope:

- **A request body** carries an operator-typed `name` and the caller's arg values. **An arg value**
  is filled into a prompt. **The token IS the secret.** None of the three is ever logged, echoed in
  an error, or put in a `path`.
- Every request logs ONE line: `[claude-watcher][api] method=<M> route=<command.id>` — the matched
  ROUTE PATTERN, never the URL (a path segment is a session id and a query value is caller input).
- A failure logs `code=…` and, for a Zod miss, `path=…`. Never the `ZodError` (it stringifies its
  input), never the thrown value (a handler's `Error` can quote a session name or a path), never an
  errno message (it quotes the absolute path, leaking the install layout).
- A 401 says NOTHING else: no path, no method, no route. An unauthenticated caller learns only that
  it was refused.

## The token

32 random bytes as 64 lowercase hex, in `claude-watcher-api-token` inside
`app.getPath('userData')`, mode 0600 — forced with a `chmodSync` ONCE PER PROCESS, on the first
`current()` that finds an existing file (`current()` caches, so later calls never reach the disk),
because `writeFileSync`'s `mode` does nothing to a file that already exists. A restored backup or a
hand copy is therefore tightened at the first request of the run, not at every read. A file that is
not EXACTLY 64 hex chars is replaced, never
trusted. It is read through a GETTER on every request, so a regenerate takes effect with no restart,
and compared with `timingSafeEqual` over sha256 of both sides (equal lengths without leaking the
real token's length through a fast reject).

The two write paths fail DIFFERENTLY and must keep doing so: the first mint is fail-soft (the token
lives in memory and the API still serves this run), while `regenerate()` THROWS `token_write_failed`
and KEEPS the old token — a revocation that never reached the disk is one the next start undoes, and
handing the operator a token that exists only in this process would be a lie.

## The SSE contract (`GET /v1/sessions/{id}/events`)

- **Every refusal is decided BEFORE `sink.start()`** — no window, no such session. Once the headers
  are out there is no response left to put an error in: `apiServer.ts` contains a late error (or a
  late throw) by ending the stream and logging a code, which is strictly worse for the caller.
- **Frame id 1 is always the SNAPSHOT.** `start()` → `onEvent` → `sink.onClose(off)` → the snapshot
  send, with NOTHING awaited in between. That order is load-bearing twice over: it is what keeps a
  delta from slipping ahead of the snapshot, and it is what stops a client that disconnects inside
  that window from parking the unsubscribe on a drained array (the hub would then hold the
  subscription for the window's whole life, invisibly — a send on a dead sink is a silent no-op).
- **`session.removed` is the LAST frame**, then the server closes. The card is gone; there is
  nothing further to report on that id.
- **NO REPLAY.** `Last-Event-ID` is ignored. The ids are a per-stream counter, not a log offset.
- **32 streams app-wide** (`API_SSE_MAX_STREAMS`), counted as STARTED sinks; past it the answer is
  503 `too_many_streams` rather than a leaked file descriptor. A `: ping` comment every 15 s keeps
  an idle stream from dying silently to an intermediary.
- **A subscriber that throws is contained** (`createApiEventHub` catches, logs a code, and iterates
  a COPY of the set) — one dead socket must not take the delta path down with it.

## `/docs` and `/openapi.json` are PUBLIC

They are consulted BEFORE the bearer check, because they are how a caller learns the rest of the API
needs a token. The OpenAPI 3.1 document is generated from the same registry the router dispatches,
via zod 4's `z.toJSONSchema`; a REQUEST schema converts with `{ io: 'input' }` so a `.default()`
field (`args`) publishes OPTIONAL — `io: 'output'` would publish it required and force every
generated client to send a field it may omit. `.trim()` and `.refine()` do NOT survive the
conversion, so wherever a rule is lost the property carries a DESCRIPTION saying so.

Swagger UI is served from `swagger-ui-dist` on disk (resolved with `createRequire(__filename)` — the
main bundle is CommonJS at runtime), and **the allow-list of three file NAMES is the whole security
posture**: the path is never joined from the request, so `/docs/package.json` is a 404 and there is
no traversal to attempt. The packaged smoke fetches the bundle asset precisely because `/docs`
itself answers 200 without opening a file.

`package.json` pins `swagger-ui-dist` EXACTLY (5.32.15) and carries
`"scarfSettings": { "enabled": false }`. That key is not decoration: the dependency pulls
`@scarf/scarf`, whose postinstall reports install telemetry, and the key is the documented opt-out.
**Do not drop it when tidying `package.json`.**

## Accepted risk (know it before you widen it)

Three of them in v1. All three are accepted because the token holder is the operator's own
automation on their own loopback interface — and all three stop being acceptable the moment that
stops being true.

**ReDoS on an operator-authored `pattern`.** It is compiled and run against CALLER input inside the
main process, so a catastrophically backtracking pattern would block main's event loop. It is
bounded only by `maxLength ≤ 200` being checked FIRST, in `validateArgs`, so the input a bad pattern
can chew on is short. Accepted because the pattern comes from the operator, not the caller — but the
ORDER (count → length → control chars → regex) is load-bearing, and running a pattern against an
unbounded value would turn an accepted risk into a real one.

**No rate limit.** A valid token may create sessions as fast as the loop allows. Each create that
gets past the gates is a real `claude` process and a real card, and nothing throttles or caps them;
the only backpressure is the 5 s `awaitSessionId`, which makes a flood SLOWER, not smaller. Accepted
because a token holder could equally drive the app's own UI — the token IS the authority here — but
a rate limit is the first thing to add if the token ever leaves this machine.

**The `overrides` map grows on every create, 504s included.** `launchSession.ts` registers a spawn
recipe per `terminalId` and never removes it — deliberately: the recipe is what a Reopen re-spawns
`claude` from, so `forget()` drops only the correlation tracking and says so. An in-app launch pays
the same cost, and the map is "bounded by the number of launches in a session"; what the API changes
is who decides how many launches a session has. A create that 504s is the sharpest case — the caller
has no id, so it retries, and every retry is another permanent entry — but the growth is not the
timeout's doing. Fix it with the rate limit above, not by clearing recipes a Reopen still needs.

## Running it locally

The API port must be FREE, like the hook ingest's 9279 (`.claude/rules/run-app.md`). They fail
differently, though: the hook server TOLERATES `EADDRINUSE` (`code=eaddrinuse`, skip, keep running,
the server-health banner, and launches without `--settings`), while the API logs
`code=listen_failed errno=…` for ANY bind error and stays down. The bind error arrives ASYNC, on
the server's `error` event; `createApiServer`'s `onError` tells `apiLifecycle`, which drops its
entry so the NEXT `apply` (any settings change, the same port included) binds again, and reports
`port_in_use` / `failed` to server health — Settings then shows "port … is used by another program"
instead of the Docs URL (R11). Before that the lifecycle believed it was running and every later
apply short-circuited until a restart. The default is 9281, not 9280: on
the operator's machine 9280 belongs to `kubectl-radar`, a daemon they use every day and which is not
ours to move. A drive scenario should still set its own port through Settings rather than assume the
default is free.

**claude's own folder-trust gate can park an API create.** On a folder it has never seen, claude
opens on "Is this a project you trust?" and reads no prompt until someone answers it in the
terminal. The create still returns 201 (the pty spawned and the id was minted); the card just sits in
`Connecting` and the expanded prompt is never submitted. No HTTP caller can answer that dialog, so a
template an automation points at must name a folder the operator has already opened in claude once.
Seen 2026-09-16 on claude 2.1.273 in the drive run, on a `mkdtemp` folder. This is claude's
behaviour, not the app's; the drive scenario answers the gate from the terminal before it waits.

## Don't

- **Don't let a caller send prose.** A create takes a template id and a list of arg VALUES; the
  prompt is the template's own `initialPrompt`, written in the app. That is the entire reason this
  API can exist. A free-text `prompt` field would make it a remote code-execution surface behind one
  bearer token.
- **Don't run a param value against a regex before its length was checked**, and don't anchor a
  pattern by hand — `compileParamPattern` compiles it standalone FIRST and then anchored, because
  wrapping alone is not enough: an unbalanced pattern closes the wrapper's group and escapes the
  anchors (`a)|(.*` → `^(?:a)|(.*)$`, an alternation anchored on neither branch, matching
  everything).
- **Don't add a third listener.** One hook ingest, one API. A new action is a command in the
  registry, not a port.
- **Don't bind `0.0.0.0`** or make the host a setting. `API_HOST` is a security posture, not a
  preference — a wildcard bind puts a session-launching API on every interface the machine has,
  behind a token the operator never chose to share.
- **Don't add CORS headers.** There is no browser origin this API serves; a permissive
  `Access-Control-Allow-Origin` would let any page the operator visits drive their board.
- **Don't widen `ApiSession`** with anything from `Session` that is content, and don't drop
  `.strict()` from any schema in `src/shared/schemas/api.ts` (`hookEvent.ts` is `.passthrough()`
  because claude owns that wire; nobody adds keys to this one but us).
- **Don't return a 200 with a body you did not validate**, and don't hand `writeError` a runtime
  value — `code` is an `ApiErrorCode` by type and the error path must never be able to throw.
- **Don't make `apply()` restart on an unrelated settings patch.** It is idempotent by design: a
  needless restart drops every open SSE stream out from under its client.
