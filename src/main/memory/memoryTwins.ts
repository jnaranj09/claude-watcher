// The twin rule for the Memory dialog's `Same value` flag: two active specifics are twins when
// they are in the same workspace (or both global) and the same folder (or both none), and their
// values are the same, character for character, and hold an exact term (`exactTerms.ts`). The
// exact-term gate exists because a short or common value (`true`, `main`, `80`) would flag
// unrelated items. Keys are not compared: a copy under the same key is a twin too.
// Pure; logs nothing (values are memory text).
import type { MemoryTwin } from '../../shared/ipc/contract'
import { isExactTerm, termRuns } from './exactTerms'

export interface TwinCandidate {
  id: string
  workspaceId: string | null
  folder: string | null
  key: string
  value: string
  updatedAt: number
}

/** The value holds at least one exact term, so two items sharing it are worth a flag. */
const holdsExactTerm = (value: string): boolean => termRuns(value).some(isExactTerm)

/** Each candidate that has a twin → its twins, in the order `rows` came in. */
export function twinsById(rows: readonly TwinCandidate[]): Map<string, MemoryTwin[]> {
  const groups = new Map<string, TwinCandidate[]>()
  for (const row of rows) {
    if (!holdsExactTerm(row.value)) continue
    const group = JSON.stringify([row.workspaceId, row.folder, row.value])
    groups.set(group, [...(groups.get(group) ?? []), row])
  }
  const twins = new Map<string, MemoryTwin[]>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (const row of group) {
      twins.set(
        row.id,
        group
          .filter((other) => other.id !== row.id)
          .map((other) => ({ id: other.id, key: other.key, updatedAt: other.updatedAt }))
      )
    }
  }
  return new Map(rows.filter((r) => twins.has(r.id)).map((r) => [r.id, twins.get(r.id) ?? []]))
}
