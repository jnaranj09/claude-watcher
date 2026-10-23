// Who sent a prompt, as the bridge mod reads it from `prompt.submit` and POSTs it to the hook
// listener at `/mod/prompt`. ONE fail-closed boundary, `.strict()`: the prompt text is never part
// of it, and a key the mod never sends is refused. A failure logs PATH + CODE only
// (zod-boundaries.md). The mod builds the same shape in src/mod/watcher-bridge/hooks/prompt.ts;
// tests/main/modPromptContract.test.ts parses its output here, so the two cannot drift.
import { z } from 'zod'

export const ModPromptSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    // claude's own word (`composer`, `task-notification`, …): NOT enum-locked, a new kind passes.
    origin: z.string()
  })
  .strict()

export type ModPrompt = z.infer<typeof ModPromptSchema>
