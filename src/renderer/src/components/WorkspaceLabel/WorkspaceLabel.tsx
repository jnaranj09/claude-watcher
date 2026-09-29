// A workspace NAME in its light tint (spec 2026-09-29-workspace-tint-design.md) — every place a
// workspace is listed by name: the scope dropdowns and the Past sessions form. It replaced the
// workspace dot: the colour is the box the name sits in, so it can never be read as a status dot.
// Unbounded operator-typed names truncate and keep a title (design.md).
import type { JSX } from 'react'
import { workspaceTintClass, type WorkspaceTone } from '../WorkspaceTint/workspaceTint'
import styles from './WorkspaceLabel.module.css'

export interface WorkspaceLabelProps {
  name: string
  tone: WorkspaceTone
  testId?: string
}

export function WorkspaceLabel({ name, tone, testId }: WorkspaceLabelProps): JSX.Element {
  return (
    <span
      className={`${styles.label} ${workspaceTintClass(tone)}`}
      data-tone={tone}
      data-testid={testId}
      title={name}
    >
      {name}
    </span>
  )
}
