// The Sessions dialog's page list and its one scope rule (spec 2026-10-03 B). Kept out of the
// component file (react-refresh/only-export-components) and pure, so it is tested without
// rendering.
import type { SessionsPage } from '../../stores/boardStore'
import { ALL_SCOPE, type ScopeFilterValue } from '../ScopeFilter/scope'

/** Page column order: the lists you manage first, the one-off action last. */
export const SESSIONS_PAGES: readonly { id: SessionsPage; label: string }[] = [
  { id: 'past', label: 'Past' },
  { id: 'templates', label: 'Templates' }
]

/** A page that lists SESSIONS offers no Global and no `(no workspace)` (every session has a
 *  workspace), so a scope carried in from Templates falls back to the unfiltered entry. */
export function scopeOnPage(page: SessionsPage, scope: ScopeFilterValue): ScopeFilterValue {
  const listsSessions = page === 'past'
  return listsSessions && (scope === 'global' || scope === 'orphans') ? ALL_SCOPE : scope
}
