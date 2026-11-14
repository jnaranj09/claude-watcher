// The twin rule for the Memory dialog's `Same value` flag: two active specifics are twins when
// they are in the same workspace (or both global) and the same folder (or both none), and their
// values are the same, character for character, and hold an exact term (`exactTerms.ts`). The
// exact-term gate exists because a short or common value (`true`, `main`, `80`) would flag
// unrelated items. Keys are not compared: a copy under the same key is a twin too.
// Linear in the rows: `twinIds` only counts each group, and `twinsOf` builds at most `shown`
// entries for one row and counts the rest, so a folder full of one value never costs a list per
// row (thousands of twins would otherwise build millions of entries on every list).
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

/** The group a row's twins share, or null when its value holds no exact term (no twin, ever). */
function groupOf(row: TwinCandidate): string | null {
  return termRuns(row.value).some(isExactTerm)
    ? JSON.stringify([row.workspaceId, row.folder, row.value])
    : null
}

/** The ids of the rows that have a twin, in the order `rows` came in. */
export function twinIds(rows: readonly TwinCandidate[]): string[] {
  const groups = rows.map(groupOf)
  const sizes = new Map<string, number>()
  for (const group of groups) if (group !== null) sizes.set(group, (sizes.get(group) ?? 0) + 1)
  return rows
    .filter((_, i) => {
      const group = groups[i]
      return group !== undefined && group !== null && (sizes.get(group) ?? 0) >= 2
    })
    .map((r) => r.id)
}

/** The twins of `id`, in the order `rows` came in: the first `shown` named, the rest counted.
 *  None for an id `rows` does not hold. */
export function twinsOf(
  rows: readonly TwinCandidate[],
  id: string,
  shown: number
): { twins: MemoryTwin[]; more: number } {
  const self = rows.find((r) => r.id === id)
  const group = self === undefined ? null : groupOf(self)
  const twins: MemoryTwin[] = []
  let more = 0
  if (group === null) return { twins, more }
  for (const row of rows) {
    if (row.id === id || groupOf(row) !== group) continue
    if (twins.length < shown) twins.push({ id: row.id, key: row.key, updatedAt: row.updatedAt })
    else more += 1
  }
  return { twins, more }
}
