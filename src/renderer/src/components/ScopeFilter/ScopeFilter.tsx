// The scope dropdown that sits in a Manage dialog's header (.claude/rules/design.md). ONE
// component for Templates and Shortcuts — the two dialogs list the same scopes and must offer
// the same choices in the same order. Past sessions drops the `Global` entry (`showGlobal={false}`):
// every record there has a workspace.
//
// Built on the project's `Select`, never a native <select>: this control is the reason that rule
// exists. Chromium draws a native popup from the desktop's GTK theme, so on a light desktop it
// dropped a white list with a blue highlight over the dark dialog, and neither
// `color-scheme: dark` nor `nativeTheme.themeSource` changed it.
import type { JSX } from 'react'
import type { Workspace } from '../../../../shared/ipc/contract'
import { WorkspaceDot, type WorkspaceTone } from '../WorkspaceDot/WorkspaceDot'
import { Select, type SelectOption } from '../Select/Select'
import { workspaceScope, type ScopeFilterValue } from './scope'

export interface ScopeFilterProps {
  value: ScopeFilterValue
  workspaces: Workspace[]
  /** Names what the unfiltered list holds — "All templates", "All shortcuts". NEVER "All
   *  workspaces": that reads as a sibling of "Global" and the two are not siblings. "Global" is
   *  a SUBSET of this entry (the rows in no workspace), and it has to keep that word because it
   *  is the same word the item's own Workspace dropdown uses when you save it. So the entries
   *  are told apart by what they are ABOUT — this one names the list, "Global" names a property
   *  of a row. */
  allLabel: string
  /** Adds `(no workspace)`. Pass `hasOrphans(rows, known)` — never `true` unconditionally. */
  showOrphans: boolean
  /** Past sessions: every record has a workspace, so there is no Global entry to offer. Default true. */
  showGlobal?: boolean
  onChange: (next: ScopeFilterValue) => void
  testId: string
  ariaLabel: string
}

export function ScopeFilter({
  value,
  workspaces,
  allLabel,
  showOrphans,
  showGlobal = true,
  onChange,
  testId,
  ariaLabel
}: ScopeFilterProps): JSX.Element {
  // Each entry carries its own swatch, which a native <option> could never do — the whole list
  // is now colour-coded, not just the closed trigger.
  const options: SelectOption<ScopeFilterValue>[] = [
    { value: 'all', label: allLabel },
    ...(showGlobal
      ? [
          {
            value: 'global' as ScopeFilterValue,
            label: 'Global',
            adornment: <WorkspaceDot tone="global" />
          }
        ]
      : []),
    ...workspaces.map((w) => ({
      value: workspaceScope(w.id),
      label: w.name,
      adornment: <WorkspaceDot tone={w.color as WorkspaceTone} />
    })),
    ...(showOrphans
      ? [
          {
            value: 'orphans' as ScopeFilterValue,
            label: '(no workspace)',
            adornment: <WorkspaceDot tone="orphan" />
          }
        ]
      : [])
  ]

  return (
    <Select
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      testId={testId}
      variant="inline"
    />
  )
}
