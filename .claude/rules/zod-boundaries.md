# Rule: fail-closed Zod boundaries

## Canonical example (do this)

```ts
// src/shared/schemas/hookEvent.ts — the ONE hook-POST adapter. Validate ONCE here.
export const HookEventSchema = z
  .object({
    session_id: z.string().min(1), // identity key; blank fails closed
    hook_event_name: z.string(), // NOT enum-locked (a new event name passes)
    notification_type: z.string().optional(), // typed optional; NOT enum-locked
    tool_name: z.string().optional(),
    last_assistant_message: z.string().optional() // SENSITIVE — never log the value
  })
  .passthrough() // claude ADDITIONS pass; known-key malformations fail closed
```

```ts
// Ingesting a hook POST: 400 + drop+log-by-PATH the bad body, keep serving the rest.
const r = HookEventSchema.safeParse(JSON.parse(body))
if (!r.success) {
  const issue = r.error.issues[0]
  log({ path: issue.path.join('.'), code: issue.code }) // PATH + CODE only — never the body
  respond400()                                          // one bad POST ≠ poison
  return
}
onHookEvent(r.data)
```

## The rule

Every EXTERNAL input is validated at exactly ONE boundary, and the boundary
**fails closed**. Pick the failure mode per boundary:

| Boundary | On bad input |
| --- | --- |
| claude hook POST (`127.0.0.1:9279`) | respond 400 + DROP the body + log by path → keep the other sessions (`hookEvent.ts` + `hookServer.ts`) |
| persisted file read (Epic 2+) | back up the bad file + start fresh (never crash on corrupt prefs) |
| renderer → main IPC arg | `Schema.parse(raw)` → THROW a typed error (untrusted cross-process input) |
| main → renderer delta | validate AT SOURCE before sending (don't ship garbage downstream) |

(The c9watch `watch`-line and `list`-snapshot rows are RETIRED — Story 6.4 removed the
CLI. The hook POST is the native engine's one external input.)

## Never-log-the-parsed-value (load-bearing)

A `ZodError` stringifies its INPUT. The input can be a hook payload carrying
prompts / `last_assistant_message` / tool input, or a session value carrying PTY
content. So: **log the error PATH + CODE only — never `error`, never the raw
body/value.** The fail-closed test (`src/__fixtures__/fakeHookFeed.test.ts`)
asserts the log call contains neither the raw body nor payload content.

## Parse-once boundary

`src/shared/schemas/hookEvent.ts` and `src/shared/schemas/session.ts` are PARSE-ONCE
boundaries. After them, consumers hold the inferred `HookEvent`/`Session` (where
`modified` is already an epoch-millis `number`). Do NOT re-run a schema over
already-parsed output — the timestamp transform expects a string input, not a
number; re-validation is unsupported. The Story-6.2 launch synthesis CONSTRUCTS a
valid `Session` from main-owned values — it never re-parses internal data.

## Don't

- Don't enum-lock `status` or `hook_event_name` (a new status/event string must NOT
  fail-closed the session — the hookStatus mapper ignores unknown events instead).
- Don't key/dedup by `pid` — key by the stable `id` (the launch-minted session uuid).
- Don't narrow `pendingToolInput` to object-only or string-only — it is polymorphic.
- Don't synthesize a session from an unknown-id hook event — that is the
  `hook_unknown_id` no-op (external sessions stay off the board).
