// The Sessions dialog's rail filter state (spec 2026-10-16 §3), beside `RailFilter`: per-scope
// memory while the dialog is open (never persisted), and the tags a scope offers.
import { useState } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { NO_FILTERS, type SessionFilters } from '../../lib/sessionFilters'
import type { PastScope } from '../PastSessionsDialog/pastSessionsView'
import { scopeWorkspaceId } from '../ScopeFilter/scope'

/** The filters of `scope`, remembered per scope while the caller stays mounted: switching scope
 *  and back brings them back. A scope never filtered reads `NO_FILTERS`. */
export function useScopedFilters(scope: string): [SessionFilters, (next: SessionFilters) => void] {
  const [byScope, setByScope] = useState<Readonly<Record<string, SessionFilters>>>({})
  return [byScope[scope] ?? NO_FILTERS, (next) => setByScope((m) => ({ ...m, [scope]: next }))]
}

/** The tags a page offers for `scope`: every tag under `All sessions`, else what that workspace
 *  can see (global and its own). Global first, then workspace-owned: the board's order. */
export function railTags(tags: readonly Tag[], scope: PastScope): Tag[] {
  const workspaceId = scopeWorkspaceId(scope)
  const offered = workspaceId === null ? [...tags] : visibleTags(tags, workspaceId)
  return [
    ...offered.filter((t) => t.workspaceId === null),
    ...offered.filter((t) => t.workspaceId !== null)
  ]
}
