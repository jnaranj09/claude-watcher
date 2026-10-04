// The Sessions dialog's page list and its one scope rule (spec 2026-10-03 B). Kept out of the
// component file (react-refresh/only-export-components) and pure, so it is tested without
// rendering.
import type { SessionsPage } from '../../stores/boardStore'
import type { Workspace } from '../../../../shared/ipc/contract'
import { ALL_SCOPE, openingScope, type ScopeFilterValue } from '../ScopeFilter/scope'

/** Page column order: the lists you manage first, the one-off action last. */
export const SESSIONS_PAGES: readonly { id: SessionsPage; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'past', label: 'Past' },
  { id: 'templates', label: 'Templates' },
  { id: 'import', label: 'Import' }
]

/** Where the dialog's dropdown OPENS. A page that lists SESSIONS opens on `All sessions` (the
 *  owner, 2026-10-03: sessions are never global, and the useful first view is every workspace);
 *  Templates opens on the active workspace, like every config list. */
export function openingScopeFor(
  page: SessionsPage,
  workspaces: Workspace[],
  activeId: string
): ScopeFilterValue {
  return listsSessions(page) ? ALL_SCOPE : openingScope(workspaces, activeId)
}

function listsSessions(page: SessionsPage): boolean {
  return page === 'active' || page === 'past'
}

/** A page that lists SESSIONS offers no Global and no `(no workspace)` (every session has a
 *  workspace), so a scope carried in from Templates falls back to the unfiltered entry. */
export function scopeOnPage(page: SessionsPage, scope: ScopeFilterValue): ScopeFilterValue {
  return listsSessions(page) && (scope === 'global' || scope === 'orphans') ? ALL_SCOPE : scope
}
