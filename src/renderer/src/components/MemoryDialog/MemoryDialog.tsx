// Memory (spec 2026-11-11 memory §8, mockup option B) — ONE Manage dialog for what sessions saved,
// its two pages in a page column (Specifics · Facts). The dialog owns the shell state, the scope
// (one workspace: main lists a workspace's items, and the global ones beside it with Include
// global), `Show stale`, and each page's filters, so a page switch closes what was open and keeps
// the rest. Search lives in the page and goes with it. Filters and search are never persisted.
// UX-DR14: App guards the opener and closes it on the quit guard.
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MEMORY_KINDS } from '../../../../shared/schemas/memory'
import { MEMORY_TERMS } from '../../copy/terms'
import { NO_FILTERS, type SessionFilters } from '../../lib/sessionFilters'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { MemoryPage } from './MemoryPage'

// The two pages the operator writes to; an episode (extraction only) has no page here.
type Kind = (typeof MEMORY_KINDS)[number]

const PAGES: readonly { id: Kind; label: string }[] = [
  { id: 'specific', label: MEMORY_TERMS.specifics },
  { id: 'fact', label: MEMORY_TERMS.facts }
]

export interface MemoryDialogProps {
  onClose: () => void
  /** Injected clock for the ages and the date filter (tests). */
  now?: () => number
}

export function MemoryDialog({ onClose, now = Date.now }: MemoryDialogProps): JSX.Element {
  const dialog = useManageDialog({ title: MEMORY_TERMS.label, testIdPrefix: 'memory', onClose })
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [kind, setKind] = useState<Kind>('specific')
  // Opens on the active workspace, like every scoped dialog (design.md "Scoped lists").
  const [workspaceId, setWorkspaceId] = useState(() =>
    workspaces.some((w) => w.id === activeWorkspaceId)
      ? activeWorkspaceId
      : (workspaces[0]?.id ?? activeWorkspaceId)
  )
  const [showStale, setShowStale] = useState(false)
  const [filters, setFilters] = useState<Readonly<Record<Kind, SessionFilters>>>({
    specific: NO_FILTERS,
    fact: NO_FILTERS
  })

  function switchPage(next: Kind): void {
    if (next === kind) return
    dialog.actions.select(null) // what was open belonged to the old page
    setKind(next)
  }

  const pages = (
    <ManageDialog.Pages
      label="Memory pages"
      pages={PAGES}
      current={kind}
      onSelect={switchPage}
      testIdPrefix="memory-page"
    />
  )

  return (
    <ManageDialog.Provider {...dialog}>
      {/* `wide`: three columns — pages | rail | form; the form is the one that shrinks. */}
      <ManageDialog.Frame size="wide">
        <MemoryPage
          key={kind}
          kind={kind}
          pageLabel={kind === 'specific' ? MEMORY_TERMS.specifics : MEMORY_TERMS.facts}
          pages={pages}
          workspaceId={workspaceId}
          setWorkspaceId={setWorkspaceId}
          showStale={showStale}
          setShowStale={setShowStale}
          filters={filters[kind]}
          setFilters={(next) => setFilters((all) => ({ ...all, [kind]: next }))}
          now={now}
        />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
