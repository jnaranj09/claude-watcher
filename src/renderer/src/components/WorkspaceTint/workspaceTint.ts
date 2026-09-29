// The tone → tint class lookup (spec 2026-09-29-workspace-tint-design.md). A workspace is drawn
// as a light tint of the control that names it — never a dot: a small coloured circle reads as a
// session STATUS here, and a blue workspace dot was read as "a card is working".
import type { WorkspaceColor } from '../../../../shared/schemas/workspace'
import styles from './WorkspaceTint.module.css'

/** A workspace colour, or one of the two scopes that are not a workspace (both untinted). */
export type WorkspaceTone = WorkspaceColor | 'global' | 'orphan'

/** The class that sets `--ws-fill` / `--ws-border` for `tone`. `global` and `orphan` get the
 *  neutral class, which RESETS them so nothing inherits a parent's tint. */
export function workspaceTintClass(tone: WorkspaceTone): string {
  if (tone === 'global' || tone === 'orphan') return styles.neutral ?? ''
  return styles[tone] ?? styles.neutral ?? ''
}
