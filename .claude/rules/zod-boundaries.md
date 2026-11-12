---
paths:
  - 'src/shared/schemas/**'
  - 'src/main/hooks/**'
  - 'src/main/persistence/**'
  - 'src/main/pty/**'
  - 'src/main/api/**'
  - 'src/main/goals/**'
  - 'src/main/mcp/**'
  - 'src/main/memory/**'
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
    last_assistant_message: z.string().optional(), // SENSITIVE — never log
    tool_input: z.unknown().optional() // SENSITIVE — never log; read only by toolDetail.ts
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

| Boundary                                                | On bad input                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hook POST (`127.0.0.1:9279`)                            | 400 + drop + log path; other sessions continue (`hookEvent.ts`, `hookServer.ts`)                                                                                                                                                                                                                                                                                                    |
| bridge mod report (`/mod/report`, same listener)        | `.strict()`; 400 + drop + log path; no live session → 409, mod resends (`modReport.ts`, `mods/sessionSetup.ts`)                                                                                                                                                                                                                                                                     |
| bridge mod prompt origin (`/mod/prompt`, same listener) | `.strict()` (`ModPromptSchema`); 400 + drop + log path + code; no live session → 409 (`code=mod_prompt_unknown_session`); handler throw → 200 + `code=mod_prompt_handler_error` (`modPromptOrigin.ts`)                                                                                                                                                                              |
| goals MCP (`/mcp/goals`, same listener)                 | bearer miss → 401 before the body; body → `-32600`, params (`.strict()`) → `-32602`; a planner's `create_task` title → `TaskSaveSchema` (`isError title_invalid`), `propose_split` groups → `ProposalGroupsSchema`; logs `code=` only (`mcp/mcpEndpoint.ts`, `goals/mcp/mcpTools.ts`)                                                                                               |
| memory MCP (`/mcp/memory`, same listener)               | its own bearer: a miss → 401 before the body; body → `-32600`; each tool's args → one `.strict()` `safeParse` → `-32602` (filters: `MemoryFiltersSchema`, `shared/memory/filterFields.ts`); an unknown tool name too, so there is no delete or pin; logs `code=` only, never memory text (`mcp/mcpEndpoint.ts`, `memory/memoryTools.ts`)                                            |
| persisted file read                                     | back up the bad file, start fresh (file history: `index.corrupt-<ts>.json`; an unreadable one moves to `index.unread-<ts>.json` before the next save, `fileHistory.ts`)                                                                                                                                                                                                             |
| `~/.claude/sessions/<pid>.json` (rebind)                | drop quietly, NO log (has cwd + name); fall back to cwd heuristic (`pty/claudeSessionFile.ts`)                                                                                                                                                                                                                                                                                      |
| same, running-elsewhere scan                            | skip quietly; answer one boolean; fail OPEN on unlistable dir (`pty/runningElsewhere.ts`)                                                                                                                                                                                                                                                                                           |
| goals file (`claude-watcher-goals.json`)                | back up the bad file, start empty, `code=goals_corrupt_reset_to_defaults`; names and titles never logged (`goals.ts`, `goal.ts`)                                                                                                                                                                                                                                                    |
| memory file (`claude-watcher-memory.db`)                | corrupt (not a database, or a read-only `PRAGMA quick_check` at open, before any write, fails) → renamed `<file>.corrupt-<ts>` (with its `-wal`/`-shm`), start empty, report `corrupt_reset`; unopenable or a newer `user_version` → no write, report `read_failed`, memory off for the run (`memory/memoryDb.ts`, `memoryStartup.ts`)                                              |
| memory rows (SQLite → main)                             | every row through a Zod schema in `MemoryDb.all` / `get`, the JSON `meta` column included (`memory/memoryRows.ts`); a bad row logs `code=memory_db_row_invalid` with its path and issue code (never a value) and throws: a read logs and throws `memory_read_failed`, no storage report; a write rolls back, reports `write_failed`, throws `store_write_failed` (`memoryStore.ts`) |
| goals IPC arg (`goals:*`)                               | `.strict()` request, `Schema.parse(raw)` → throw typed error; no path ever comes from the renderer; Accept's edited groups → the `goals:start-sessions` schema (`goalsIpc.ts`)                                                                                                                                                                                                      |
| memory IPC arg (`memory:*`)                             | `.strict()` request, `Schema.parse(raw)` → throw (`memory/memoryIpc.ts`); refusals are codes (`memory_not_found`, `memory_version_not_found`, `memory_read_failed`, `store_write_failed`); no store → `memory_unavailable` from every handler but `memory:activity`                                                                                                                 |
| renderer → main IPC arg                                 | `Schema.parse(raw)` → throw typed error                                                                                                                                                                                                                                                                                                                                             |
| goals push (`goals:changed`)                            | `GoalsViewSchema.safeParse` before send; drop + log path and code (`sendGoalsChanged.ts`)                                                                                                                                                                                                                                                                                           |
| memory push (`memory:changed`)                          | an empty payload parsed once by `MemoryChangedSchema` before any send (`sendMemoryChanged.ts`); no memory text: the renderer lists again                                                                                                                                                                                                                                            |
| main → renderer delta                                   | validate at source before sending                                                                                                                                                                                                                                                                                                                                                   |

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
