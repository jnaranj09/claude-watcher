// The ONE swatch that stands for a workspace anywhere in the app (.claude/rules/design.md).
// Before this file the dot lived as a copy-pasted `.dot` + six color classes in
// WorkspaceSwitcher.module.css AND WorkspacesDialog.module.css — two renderings of one concept,
// already drifting.
//
// `tone` is ONE flat union — a workspace color, or one of the two non-workspace scopes — so a
// caller cannot pass a color for Global or forget the color for a real workspace. Global draws a
// hollow ring and `(no workspace)` a dim disc: both stay distinguishable in greyscale, because
// the dot is never the sole carrier of meaning (the label text is always beside it; the UX-DR29
// precedent from StatusDot).
import type { JSX } from 'react'
import type { WorkspaceColor } from '../../../../shared/schemas/workspace'
import styles from './WorkspaceDot.module.css'

export type WorkspaceTone = WorkspaceColor | 'global' | 'orphan'

/** `noUncheckedIndexedAccess`-safe class lookup: `styles` is an index signature, so a missing
 *  class is `undefined` at the type level. Falls back to the neutral disc rather than rendering
 *  a `class="undefined"` (invisible) dot. */
function toneClass(tone: WorkspaceTone): string {
  return styles[tone] ?? styles.orphan ?? ''
}

export interface WorkspaceDotProps {
  tone: WorkspaceTone
}

/** The swatch on its own — for places that already render the name themselves (the switcher
 *  button, a list row, the color picker's radio options). */
export function WorkspaceDot({ tone }: WorkspaceDotProps): JSX.Element {
  return <span className={`${styles.dot} ${toneClass(tone)}`} aria-hidden="true" />
}
