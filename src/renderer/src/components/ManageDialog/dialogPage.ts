// The props every PAGE of a paged Manage dialog takes (spec 2026-10-03 B/C). The dialog owns the
// scope — it survives a page switch — and the page column, which each page renders FIRST inside
// its own <Columns>. Its own file so ManageDialogParts.tsx keeps exporting components only.
import type { ReactNode } from 'react'
import type { ScopeFilterValue } from '../ScopeFilter/scope'

export interface DialogPageProps {
  scope: ScopeFilterValue
  setScope: (next: ScopeFilterValue) => void
  /** The page column (`ManageDialog.Pages`). */
  pages: ReactNode
}
