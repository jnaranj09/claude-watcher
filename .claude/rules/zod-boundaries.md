---
paths:
  - 'src/shared/schemas/**'
  - 'src/main/hooks/**'
  - 'src/main/persistence/**'
  - 'src/main/pty/**'
  - 'src/main/api/**'
---

# Rule: fail-closed Zod boundaries

```ts
// src/shared/schemas/hookEvent.ts — the ONE hook-POST adapter.
export const HookEventSchema = z
  .object({
    session_id: z.string().min(1), // identity; blank fails closed
    hook_event_name: z.string(), // NOT enum-locked
    notification_type: z.string().optional(),
    tool_name: z.string().optional(),
    last_assistant_message: z.string().optional() // SENSITIVE — never log
  })
  .passthrough() // claude additions pass; known-key malformations fail closed

const r = HookEventSchema.safeParse(JSON.parse(body))
if (!r.success) {
  const issue = r.error.issues[0]
  log({ path: issue.path.join('.'), code: issue.code }) // PATH + CODE only
  respond400()
  return
}
onHookEvent(r.data)
```

Every EXTERNAL input is validated at exactly ONE boundary that fails closed:

| Boundary                                 | On bad input                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| hook POST (`127.0.0.1:9279`)             | 400 + drop + log path; other sessions continue (`hookEvent.ts`, `hookServer.ts`)               |
| persisted file read                      | back up the bad file, start fresh                                                              |
| `~/.claude/sessions/<pid>.json` (rebind) | drop quietly, NO log (has cwd + name); fall back to cwd heuristic (`pty/claudeSessionFile.ts`) |
| same, running-elsewhere scan             | skip quietly; answer one boolean; fail OPEN on unlistable dir (`pty/runningElsewhere.ts`)      |
| renderer → main IPC arg                  | `Schema.parse(raw)` → throw typed error                                                        |
| main → renderer delta                    | validate at source before sending                                                              |

Other external input: the transcript tail (`transcriptEntry.ts`).

**Never log the parsed value.** A `ZodError` stringifies its input (prompts, assistant text, tool
input, PTY content). Log PATH + CODE only — never `error`, never the body. Asserted by
`src/__fixtures__/fakeHookFeed.test.ts`.

**Parse once.** `hookEvent.ts`, `session.ts`, `claudeSessionFile.ts` are parse-once; never re-run a
schema over parsed output (the timestamp transform expects a string). Launch synthesis CONSTRUCTS a
valid `Session`, never re-parses.

## Don't

- Enum-lock `status` or `hook_event_name`.
- Key/dedup by `pid` (use the stable `id`).
- Narrow `pendingToolInput` (polymorphic).
- Synthesize a session from an unknown-id hook (`hook_unknown_id` no-op).
