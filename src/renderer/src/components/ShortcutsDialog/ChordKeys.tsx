// Phrase shortcuts — render a chord (or a short list of them) as key chips.
//
// Since the expander replaced per-shortcut chord sequences with the ONE `expanderKey` open
// chord, every caller passes a single-element array (the dialog subtitle and the header
// recorder both do `keys={[chord]}`). The array shape stays rather than narrowing the prop to
// one string: one chip per chord reads better than cramming multiple chords into one mono
// string, and keeping the list shape costs nothing while leaving room for a future caller that
// legitimately shows more than one chord side by side.
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
