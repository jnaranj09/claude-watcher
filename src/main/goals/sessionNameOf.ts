// The name a planner prompt shows for a session that worked on its goal (spec 2026-11-18 memory
// session goals, "Planner prompt"). The live card's name is not schema-checked (claude's own
// `session_title` can overwrite it, `hooks/titleReadBack.ts`), so whichever name is returned is
// cleaned here. Pure; logs nothing (a name is operator or model text).
import type { PastSession } from '../../shared/schemas/pastSession'
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'
import { cutToUnits, toSafeLine } from '../../shared/textCut'

/**
 * The live card's name (`''` counts as none), else the Past sessions record's name, else null.
 * The name is made one clean line (`toSafeLine`), then cut to `SESSION_NAME_MAX_LENGTH`; an empty
 * result is null.
 */
export function sessionNameOf(
  deps: {
    liveName(id: string): string | undefined
    record(id: string): PastSession | null
  },
  id: string
): string | null {
  const live = deps.liveName(id)
  const raw = live !== undefined && live !== '' ? live : (deps.record(id)?.name ?? null)
  if (raw === null) return null
  const name = cutToUnits(toSafeLine(raw), SESSION_NAME_MAX_LENGTH)
  return name === '' ? null : name
}
