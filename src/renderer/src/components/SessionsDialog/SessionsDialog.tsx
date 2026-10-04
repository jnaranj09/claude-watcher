// Sessions (spec 2026-10-03 B) — ONE Manage dialog for everything about sessions, its pages in a
// page column on the left (Active · Past · Templates · Import). The page is the store's view-state (`boardStore.sessionsDialog`, never
// persisted): App hands it in and takes page changes back. This dialog owns the shell state and
// the scope, so a page switch closes what was open (the search lives in the page and goes with it)
// but KEEPS the scope. UX-DR14: App guards every opener and closes it on the quit guard.
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SessionsPage } from '../../stores/boardStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import type { DialogPageProps } from '../ManageDialog/dialogPage'
import { PastSessionsPage } from '../PastSessionsDialog/PastSessionsPage'
import { openingScope, type ScopeFilterValue } from '../ScopeFilter/scope'
import { TemplatesPage } from '../TemplatesDialog/TemplatesPage'
import { ActiveSessionsPage } from './ActiveSessionsPage'
import { ImportSessionPage } from './ImportSessionPage'
import { SESSIONS_PAGES, scopeOnPage } from './sessionsPages'

export interface SessionsDialogProps {
  page: SessionsPage
  /** A page row was pressed. App hands it to the store (`openSessionsDialog`). */
  onPageChange: (next: SessionsPage) => void
  onClose: () => void
  /** Injected clock for the relative times (tests). */
  now?: () => number
}

export function SessionsDialog({
  page,
  onPageChange,
  onClose,
  now = Date.now
}: SessionsDialogProps): JSX.Element {
  const dialog = useManageDialog({ title: 'Sessions', testIdPrefix: 'sessions', onClose })
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [scope, setScope] = useState<ScopeFilterValue>(() =>
    scopeOnPage(page, openingScope(workspaces, activeWorkspaceId))
  )

  function switchPage(next: SessionsPage): void {
    if (next === page) return
    // What was open belonged to the old page: close it (the placeholder), like a scope change. A
    // dirty Templates form is dropped, as closing the dialog drops it (spec B).
    dialog.actions.select(null)
    setScope((current) => scopeOnPage(next, current))
    onPageChange(next)
  }

  const pages = (
    <ManageDialog.Pages
      label="Sessions pages"
      pages={SESSIONS_PAGES}
      current={page}
      onSelect={switchPage}
      testIdPrefix="sessions-page"
    />
  )
  const props: DialogPageProps = { scope, setScope, pages }

  function body(): JSX.Element {
    switch (page) {
      case 'active':
        return <ActiveSessionsPage {...props} now={now} />
      case 'past':
        return <PastSessionsPage {...props} now={now} />
      case 'templates':
        return <TemplatesPage {...props} />
      case 'import':
        return <ImportSessionPage pages={pages} />
    }
  }

  return (
    <ManageDialog.Provider {...dialog}>
      {/* `wide`: three columns — pages | rail | form; the form is the one that shrinks. */}
      <ManageDialog.Frame size="wide">{body()}</ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
