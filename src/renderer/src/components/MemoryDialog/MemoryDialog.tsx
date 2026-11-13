// Memory (spec 2026-11-11 memory §8, mockup option B) — ONE Manage dialog for what sessions saved,
// its four pages in a page column (Specifics · Facts · Episodes · Commands; memory phase 2 adds the
// last two: what each session did, and the commands that worked). The dialog owns the shell
// state, the scope (one workspace: main lists a workspace's items, and the global ones beside it
// with Include global), `Show stale`, and each item page's filters, so a page switch closes what
// was open and keeps the rest. Commands has its own page (CommandsPage: a search, no filters).
// Search lives in the page and goes with it. Filters and search are never persisted.
// Opened from a result toast's `Show` (memory phase 2), every page starts filtered on that
// session (`memoryDialogTarget`); the operator can remove the filter like any other.
// UX-DR14: App guards the opener and closes it on the quit guard.
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MemoryItemKind } from '../../../../shared/schemas/memory'
import { MEMORY_TERMS } from '../../copy/terms'
import { NO_FILTERS, type SessionFilters } from '../../lib/sessionFilters'
import { selectMemoryDialogTarget, useBoard } from '../../stores/boardStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { CommandsPage } from './CommandsPage'
import { MemoryPage } from './MemoryPage'

// The item pages (an episode is written by extraction only, and shown read-only), then Commands.
type Page = MemoryItemKind | 'command'

const PAGES: readonly { id: Page; label: string }[] = [
  { id: 'specific', label: MEMORY_TERMS.specifics },
  { id: 'fact', label: MEMORY_TERMS.facts },
  { id: 'episode', label: MEMORY_TERMS.episodes },
  { id: 'command', label: MEMORY_TERMS.commands }
]

const PAGE_LABEL: Readonly<Record<MemoryItemKind, string>> = {
  specific: MEMORY_TERMS.specifics,
  fact: MEMORY_TERMS.facts,
  episode: MEMORY_TERMS.episodes
}

export interface MemoryDialogProps {
  onClose: () => void
  /** Injected clock for the ages and the date filter (tests). */
  now?: () => number
}

export function MemoryDialog({ onClose, now = Date.now }: MemoryDialogProps): JSX.Element {
  const dialog = useManageDialog({ title: MEMORY_TERMS.label, testIdPrefix: 'memory', onClose })
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [page, setPage] = useState<Page>('specific')
  // Opens on the active workspace, like every scoped dialog (design.md "Scoped lists").
  const [workspaceId, setWorkspaceId] = useState(() =>
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? activeWorkspaceId
      : (workspaces[0]?.id ?? activeWorkspaceId)
  )
  const [showStale, setShowStale] = useState(false)
  // Read once, for the first render only: the target is where the dialog STARTS.
  const target = useBoard(selectMemoryDialogTarget)
  const [filters, setFilters] = useState<Readonly<Record<MemoryItemKind, SessionFilters>>>(() => {
    const start: SessionFilters =
      target === null ? NO_FILTERS : { ...NO_FILTERS, sessionNames: [target.sessionName] }
    return { specific: start, fact: start, episode: start }
  })

  function switchPage(next: Page): void {
    if (next === page) return
    dialog.actions.select(null) // what was open belonged to the old page
    setPage(next)
  }

  const pages = (
    <ManageDialog.Pages
      label="Memory pages"
      pages={PAGES}
      current={page}
      onSelect={switchPage}
      testIdPrefix="memory-page"
    />
  )

  return (
    <ManageDialog.Provider {...dialog}>
      {/* `wide`: three columns — pages | rail | form; the form is the one that shrinks. */}
      <ManageDialog.Frame size="wide">
        {page === 'command' ? (
          <CommandsPage
            pages={pages}
            workspaceId={workspaceId}
            setWorkspaceId={setWorkspaceId}
            now={now}
          />
        ) : (
          <MemoryPage
            key={page}
            kind={page}
            pageLabel={PAGE_LABEL[page]}
            pages={pages}
            workspaceId={workspaceId}
            setWorkspaceId={setWorkspaceId}
            showStale={showStale}
            setShowStale={setShowStale}
            filters={filters[page]}
            setFilters={(next) => setFilters((all) => ({ ...all, [page]: next }))}
            now={now}
          />
        )}
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
