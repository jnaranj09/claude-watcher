// The placeholder reference: every token a phrase may carry and what it takes. Shown under the
// Phrase field and in the phrase editor, so the operator never has to remember the syntax.
import type { JSX } from 'react'
import { PLACEHOLDER_HELP } from '../../shortcuts/expand'
import styles from './ShortcutsDialog.module.css'

export function PlaceholderHelp({ testId }: { testId: string }): JSX.Element {
  return (
    <dl className={styles.placeholders} data-testid={testId}>
      {PLACEHOLDER_HELP.map((h) => (
        <div key={h.token} className={styles.placeholderRow}>
          <dt className={styles.placeholderToken}>{h.token}</dt>
          <dd className={styles.placeholderMeaning}>{h.meaning}</dd>
        </div>
      ))}
    </dl>
  )
}
