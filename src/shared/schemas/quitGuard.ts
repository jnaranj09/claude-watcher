// Story 4.2 (FR-14) — the QuitGuardPayload Zod schema.
//
// Validate-at-source for the `quit:guard-show` main→renderer push. Main computes
// the liveness payload and validates IT before sending, so the renderer never
// receives garbage (main→renderer = validate at source, zod-boundaries.md).
//
// NEVER log a session value/path: a QuitGuardPayload carries sessionName and
// status which are session-shaped data — log path/code only on a parse miss.
//
// The per-session `column` field uses the shared ColumnSchema (same definition
// as the board; never a private string-literal copy that can drift).
//
// [Source: story 4.2 Task 3.2; .claude/rules/zod-boundaries.md (validate-at-source,
//  never-log-the-value); src/shared/schemas/watchDelta.ts (validate-at-source pattern);
//  src/shared/ipc/contract.ts (QuitGuardPayload shape)]

import { z } from 'zod'
import { COLUMNS } from '../ipc/contract'

/** The three live board columns — derived from the shared COLUMNS tuple, never a copy. */
const ColumnSchema = z.enum(COLUMNS)

/** Per-session row in the Quit-guard modal list. */
const QuitGuardSessionSchema = z.object({
  /** Stable session id (UUID). NEVER pid. */
  id: z.string().min(1),
  sessionName: z.string(),
  status: z.string(),
  column: ColumnSchema
})

/**
 * Schema for the `quit:guard-show` push payload.
 * Validated AT SOURCE in main before `wc.send` (main→renderer = validate at source).
 *
 * On a parse miss: log path + code ONLY — never the value (the payload carries
 * sessionName data). Drop the send (fail-closed at source).
 */
export const QuitGuardPayloadSchema = z.object({
  /** Total live app-launched sessions (launched-set ∩ present). */
  total: z.number().int().nonnegative(),
  /**
   * How many of those are in the `working` column (actively running agents).
   * Highlighted in the modal: "N agents are still working."
   */
  workingCount: z.number().int().nonnegative(),
  /** Per-session detail for the modal list. */
  sessions: z.array(QuitGuardSessionSchema)
})

export type QuitGuardPayloadSchemaType = z.infer<typeof QuitGuardPayloadSchema>
