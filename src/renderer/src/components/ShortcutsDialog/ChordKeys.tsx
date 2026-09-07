// Phrase shortcuts — render a 1..3 chord sequence as key chips.
//
// One chip per chord: "Ctrl+Alt+O Ctrl+Alt+A Ctrl+Alt+B" as a single mono string is 32 characters
// of near-identical text and reads as noise. The chips also carry a literal space between them, so
// the accessible/text form of the element stays the space-joined id (shortcutKeysId).
import { Fragment, type JSX } from 'react'
import styles from './ShortcutsDialog.module.css'

export interface ChordKeysProps {
  keys: readonly string[]
}

export function ChordKeys({ keys }: ChordKeysProps): JSX.Element {
  return (
    <span className={styles.chordKeys}>
      {keys.map((chord, i) => (
        <Fragment key={`${i}-${chord}`}>
          {i > 0 ? ' ' : null}
          <kbd className={styles.chord}>{chord}</kbd>
        </Fragment>
      ))}
    </span>
  )
}
