// Tags (spec 2026-10-03 C) — ONE dialog for the two halves of tagging: Tags (what exists) and
// Rules (what applies them), as pages in a page column, so the operator moves between them in one
// click. The page is the store's view-state (`boardStore.tagsDialog`); this dialog owns the shell
// state and the scope, so a page switch closes what was open and KEEPS the scope (both pages offer
// the same scopes). UX-DR14: App guards both openers and closes it on the quit guard.
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TagsDialogPage } from '../../stores/boardStore'
import {
  selectActiveWorkspaceId,
  selectWorkspaces,
  useWorkspaces
} from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { RulesPage } from '../RulesDialog/RulesPage'
import { openingScope, type ScopeFilterValue } from '../ScopeFilter/scope'
import { TagsPage } from './TagsPage'

const PAGES: readonly { id: TagsDialogPage; label: string }[] = [
  { id: 'tags', label: 'Tags' },
  { id: 'rules', label: 'Rules' }
]

export interface TagsDialogProps {
  page: TagsDialogPage
  onPageChange: (next: TagsDialogPage) => void
  onClose: () => void
}

export function TagsDialog({ page, onPageChange, onClose }: TagsDialogProps): JSX.Element {
  const dialog = useManageDialog({ title: 'Tags', testIdPrefix: 'tags', onClose })
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const [scope, setScope] = useState<ScopeFilterValue>(() =>
    openingScope(workspaces, activeWorkspaceId)
  )

  function switchPage(next: TagsDialogPage): void {
    if (next === page) return
    dialog.actions.select(null) // what was open belonged to the old page
    onPageChange(next)
  }

  const pages = (
    <ManageDialog.Pages
      label="Tags pages"
      pages={PAGES}
      current={page}
      onSelect={switchPage}
      testIdPrefix="tags-page"
    />
  )

  return (
    <ManageDialog.Provider {...dialog}>
      {/* `wide`: Rules' form carries trigger, condition and action rows side by side. */}
      <ManageDialog.Frame size="wide">
        {page === 'tags' ? (
          <TagsPage scope={scope} setScope={setScope} pages={pages} />
        ) : (
          <RulesPage scope={scope} setScope={setScope} pages={pages} />
        )}
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
