// The Sessions dialog's rail filter state (spec 2026-10-16 §3), beside `RailFilter`: the memory of
// every page's filters per scope while the dialog is open (never persisted), and the tags a scope
// offers.
import { useState } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { NO_FILTERS, type SessionFilters } from '../../lib/sessionFilters'
import type { PastScope } from '../PastSessionsDialog/pastSessionsView'
import { scopeWorkspaceId } from '../ScopeFilter/scope'

/** The pages that filter their rows. */
export type FilteredPage = 'active' | 'past'

/** Every filtered page's filters, per scope. */
export interface ScopedFilters {
  /** The filters of `page` in `scope`; a pair never filtered reads `NO_FILTERS`. */
  read: (page: FilteredPage, scope: string) => SessionFilters
  write: (page: FilteredPage, scope: string, next: SessionFilters) => void
}

/** The memory behind `ScopedFilters`, held by the caller: `SessionsDialog`, which stays mounted
 *  while its pages switch. A page switch, or a scope switch, and back brings a page's filters
 *  back; closing the dialog unmounts it and the memory with it. */
export function useScopedFilters(): ScopedFilters {
  const [byKey, setByKey] = useState<Readonly<Record<string, SessionFilters>>>({})
  const key = (page: FilteredPage, scope: string): string => `${page}|${scope}`
  return {
    read: (page, scope) => byKey[key(page, scope)] ?? NO_FILTERS,
    write: (page, scope, next) => setByKey((m) => ({ ...m, [key(page, scope)]: next }))
  }
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
