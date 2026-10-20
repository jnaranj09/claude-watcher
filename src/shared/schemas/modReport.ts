// The bridge mod's report (spec 2026-10-18 §2), POSTed to the hook listener at `/mod/report`.
// ONE fail-closed boundary: `.strict()` at every level, so a key the mod never sends (a settings
// value, file content) is refused, not carried. Values are SENSITIVE (paths name the operator's
// folders): a failure logs PATH + CODE only (zod-boundaries.md). The mod builds the same shape in
// src/mod/watcher-bridge/hooks/report.ts; tests/unit/bridgeModReport.test.ts parses its output
// here, so the two cannot drift.
import { z } from 'zod'

const tokens = z.number().int().nonnegative()

export const ModReportSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    // `kind` is claude's own word (`user`, `project`, …): NOT enum-locked, a new tier passes.
    instructionFiles: z.array(
      z
        .object({ path: z.string().min(1), kind: z.string(), parent: z.string().optional() })
        .strict()
    ),
    memoryFiles: z.array(z.object({ path: z.string(), type: z.string(), tokens }).strict()),
    skills: z
      .array(
        z
          .object({
            name: z.string(),
            source: z.string(),
            pluginName: z.string().optional(),
            tokens
          })
          .strict()
      )
      .nullable(),
    agents: z.array(z.object({ agentType: z.string(), source: z.string(), tokens }).strict()),
    mcpServers: z.array(
      z
        .object({
          name: z.string(),
          toolCount: z.number().int().nonnegative(),
          tokens,
          loadedCount: z.number().int().nonnegative()
        })
        .strict()
    ),
    slashCommands: z.object({ total: z.number().int().nonnegative(), tokens }).strict().nullable(),
    hookEvents: z.array(
      z
        .object({ event: z.string(), source: z.string(), count: z.number().int().nonnegative() })
        .strict()
    ),
    plugins: z.array(z.object({ name: z.string(), source: z.string() }).strict())
  })
  .strict()

export type ModReport = z.infer<typeof ModReportSchema>
