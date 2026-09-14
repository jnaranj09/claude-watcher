// The "press a chord" control for the expander's open chord — records exactly ONE
// `Ctrl+Alt+<letter>`. While armed it swallows the keydown entirely (preventDefault +
// stopPropagation) so recording can never fire an app binding, activate this very button, or
// leak into a terminal. What counts as a chord is the SHARED chordFromEvent, the same function
// the terminal's open check uses — so recording and matching can never disagree (AltGr guard
// included).
//
// This is a deliberate simplification of the original spec's `maxChords` prop: the recorder now
// has exactly ONE caller (the dialog header's "Open with" control), so a configurable recording
// depth would be dead configuration. If a second caller ever needs a multi-chord sequence again,
// reintroduce the prop then.
import { useState, type JSX, type KeyboardEvent } from 'react'
import { chordFromEvent } from '../../shortcuts/chord'
import { ChordKeys } from './ChordKeys'
import styles from './ShortcutsDialog.module.css'

export interface KeyChordRecorderProps {
  /** The current chord (`Ctrl+Alt+X`), or null when none is set. */
  value: string | null
  onChange: (chord: string) => void
}

const RESTING_HELP = 'Click, then hold Ctrl+Alt and press a letter.'

export function KeyChordRecorder({ value, onChange }: KeyChordRecorderProps): JSX.Element {
  const [armed, setArmed] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  function disarm(): void {
    setArmed(false)
    setHint(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!armed) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      disarm()
      return
    }
    const chord = chordFromEvent(e.nativeEvent)
    if (chord === null) {
      setHint('Hold Ctrl+Alt and press a letter.')
      return
    }
    onChange(chord)
    disarm()
  }

  return (
    <div className={styles.recorder}>
      <button
        type="button"
        className={[
          styles.recorderButton,
          armed ? styles.recorderArmed : '',
          !armed && value !== null ? styles.recorderSet : ''
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid="chord-recorder"
        aria-label="Record the chord that opens the shortcut box"
        onClick={() => {
          setArmed(true)
          setHint(null)
        }}
        onBlur={disarm}
        onKeyDown={handleKeyDown}
      >
        {armed ? 'Press a chord…' : value === null ? 'Set chord' : <ChordKeys keys={[value]} />}
      </button>
      {armed ? (
        <span className={styles.recorderHint} data-testid="chord-hint" role="status">
          {hint ?? 'Press the chord now. Escape cancels.'}
        </span>
      ) : (
        <span className={styles.fieldHelp}>{RESTING_HELP}</span>
      )}
    </div>
  )
}
