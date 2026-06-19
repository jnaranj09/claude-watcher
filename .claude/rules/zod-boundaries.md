# Rule: fail-closed Zod boundaries

## Canonical example (do this)

```ts
// src/shared/schemas/session.ts — the ONE c9watch adapter. Validate ONCE here.
export const SessionSchema = z
  .object({
    id: z.string().min(1),                 // identity key; blank id fails closed
    status: z.string(),                     // NOT enum-locked (a new status passes)
    pid: z.number().int().nonnegative(),    // wandering thread id, NEVER identity
    modified: IsoToEpochMillis.optional(),  // ISO+tz → epoch-millis, fails on tz-less
    pendingToolInput: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
  })
  .passthrough()                            // c9watch ADDITIONS pass; known-key
                                            // malformations fail closed
```

```ts
// Replaying a watch stream: drop+log-by-PATH the bad line, keep the good ones.
const r = WatchLineSchema.safeParse(JSON.parse(line))
if (!r.success) {
  const issue = r.error.issues[0]
  log({ path: issue.path.join('.'), code: issue.code }) // PATH + CODE only — never the value
  continue                                              // one bad line ≠ poison
}
apply(r.data)
```

## The rule

Every EXTERNAL input is validated at exactly ONE boundary, and the boundary
**fails closed**. Pick the failure mode per boundary:

| Boundary | On bad input |
| --- | --- |
| c9watch NDJSON `watch` line | DROP the line + log by path → keep the other sessions |
| c9watch `list` snapshot | parse via `parseListKeyedById`; a malformed snapshot throws → caller decides (reconnect/back off) |
| persisted file read (Epic 2+) | back up the bad file + start fresh (never crash on corrupt prefs) |
| renderer → main IPC arg | `Schema.parse(raw)` → THROW a typed error (untrusted cross-process input) |
| main → renderer delta | validate AT SOURCE before sending (don't ship garbage downstream) |

## Never-log-the-parsed-value (load-bearing)

A `ZodError` stringifies its INPUT. The input can be a c9watch session carrying PTY
content / prompts / secrets. So: **log the error PATH + CODE only — never
`error`, never the raw line/value.** The fail-closed test
(`src/__fixtures__/fakeC9watchFeed.test.ts`) asserts the log call contains neither
the raw line nor session content.

## Parse-once boundary

`src/shared/schemas/session.ts` is a PARSE-ONCE boundary. After it, consumers hold
the inferred `Session` (where `modified`/`timestamp` are already epoch-millis
`number`s). Do NOT re-run the schema over already-parsed output — the timestamp
transform expects a string input, not a number; re-validation is unsupported.

## Don't

- Don't enum-lock `status` (c9watch may emit a new state; that must NOT fail-closed
  the session).
- Don't key/dedup by `pid` — key by `id`. A duplicate `id` THROWS
  `DuplicateSessionIdError` (never silent last-write-wins).
- Don't narrow `pendingToolInput` to object-only or string-only — it is polymorphic.
