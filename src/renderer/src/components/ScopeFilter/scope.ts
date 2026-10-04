// The scope filter's value + the pure filtering it drives. Kept out of the component file so
// both Manage dialogs and their tests can use it without rendering anything.
//
// `ws:` prefixes the workspace ids so the three reserved values can never collide with one —
// a workspace named or ID'd `all` is otherwise indistinguishable from the unfiltered entry.
import type { Workspace } from '../../../../shared/ipc/contract'

export type ScopeFilterValue = 'all' | 'global' | 'orphans' | `ws:${string}`

export const ALL_SCOPE: ScopeFilterValue = 'all'

/** The filter value naming one workspace. */
export function workspaceScope(id: string): ScopeFilterValue {
  return `ws:${id}`
}

/** Where a scoped dialog OPENS: the active workspace — the rows you most likely came for — or the
 *  unfiltered entry when that id names no known workspace (a dropdown never sits on a value it does
 *  not offer — design.md). */
export function openingScope(workspaces: Workspace[], activeId: string): ScopeFilterValue {
  return workspaces.some((w) => w.id === activeId) ? workspaceScope(activeId) : ALL_SCOPE
}

/** The workspace id a value names, or null for the three non-workspace values. */
export function scopeWorkspaceId(value: ScopeFilterValue): string | null {
  return value.startsWith('ws:') ? value.slice('ws:'.length) : null
}

/** The set of ids the dropdown can offer — everything else is an orphan. */
export function knownWorkspaceIds(workspaces: Workspace[]): Set<string> {
  return new Set(workspaces.map((w) => w.id))
}

/** Where a row belongs: its own workspace, Global, or orphans when its workspace is gone. */
export function scopeOf(workspaceId: string | null, known: ReadonlySet<string>): ScopeFilterValue {
  if (workspaceId === null) return 'global'
  return known.has(workspaceId) ? workspaceScope(workspaceId) : 'orphans'
}

/**
 * Filtering by scope. A workspace value shows that workspace's rows and — when `includeGlobal`, the
 * operator's ONE remembered choice (spec 2026-10-03 H, `settings.includeGlobal`) — the global rows
 * too, because those apply there as well: "what applies to me here". Every row carries a marker
 * saying where it lives (`ScopeMarker`), so a global row is never edited by mistake as if it were
 * the workspace's. Global shows global rows only; `(no workspace)` the orphans; `'all'` every row.
 * The INPUT order is kept; a list that wants its own rows first groups them itself. `includeGlobal`
 * is REQUIRED: every call site decides.
 */
export function filterByScope<T extends { workspaceId: string | null }>(
  rows: T[],
  scope: ScopeFilterValue,
  known: ReadonlySet<string>,
  includeGlobal: boolean
): T[] {
  if (scope === ALL_SCOPE) return rows
  const withGlobal = includeGlobal && scopeWorkspaceId(scope) !== null
  return rows.filter((r) => {
    const own = scopeOf(r.workspaceId, known)
    return own === scope || (withGlobal && own === 'global')
  })
}

/** True when any row's workspace is gone — the ONLY condition that puts `(no workspace)` on the
 *  dropdown. Offering it always would advertise a state that normally cannot happen. */
export function hasOrphans(
  rows: { workspaceId: string | null }[],
  known: ReadonlySet<string>
): boolean {
  return rows.some((r) => r.workspaceId !== null && !known.has(r.workspaceId))
}
