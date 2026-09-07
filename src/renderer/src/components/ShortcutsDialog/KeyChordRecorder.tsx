// Phrase shortcuts — the "press a chord" control, recording a SEQUENCE of 1..3 chords.
// While armed it swallows the keydown entirely (preventDefault + stopPropagation) so recording
// can never fire an app binding, activate this very button, or leak into a terminal.
// What counts as a chord is decided by the SHARED chordFromEvent, the same function the terminal
// matcher uses — so recording and matching can never disagree (the AltGr guard included).
import { useState, type JSX, type KeyboardEvent } from 'react'
import { chordFromEvent } from '../../shortcuts/chord'
import { shortcutKeysId, SHORTCUT_SEQUENCE_MAX_CHORDS } from '../../../../shared/schemas/shortcut'
import { ChordKeys } from './ChordKeys'
import styles from './ShortcutsDialog.module.css'

export interface KeyChordRecorderProps {
  value: readonly string[]
  onChange: (keys: string[]) => void
}

/** The line under the button when nothing is being recorded — the one-time "how" for a new user. */
const RESTING_HELP = 'Click, then hold Ctrl+Alt and press a letter. Chain up to 3 for a sequence.'

export function KeyChordRecorder({ value, onChange }: KeyChordRecorderProps): JSX.Element {
  const [armed, setArmed] = useState(false)
  const [captured, setCaptured] = useState<string[]>([])
  const [hint, setHint] = useState<string | null>(null)

  function disarm(): void {
    setArmed(false)
    setCaptured([])
    setHint(null)
  }

  function commit(keys: string[]): void {
    onChange(keys)
    disarm()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!armed) return
    // Never let a recording keystroke escape to the app or a terminal — and this is also what
    // stops Enter/Space activating the button itself.
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      // Discard the partial recording; the previously saved value is untouched.
      disarm()
      return
    }
    if (e.key === 'Enter') {
      // Finish a 1- or 2-chord sequence without waiting for the 3-chord cap.
      if (captured.length > 0) commit(captured)
      return
    }
    if (e.key === 'Backspace') {
      setCaptured((prev) => prev.slice(0, -1))
      setHint(null)
      return
    }

    const chord = chordFromEvent(e.nativeEvent)
    if (chord === null) {
      setHint('Hold Ctrl+Alt and press a letter.')
      return
    }
    const next = [...captured, chord]
    if (next.length >= SHORTCUT_SEQUENCE_MAX_CHORDS) {
      commit(next)
      return
    }
    setCaptured(next)
    setHint(`${shortcutKeysId(next)} recorded. Press another chord, or Enter to finish.`)
  }

  // The armed line is the live coaching; the resting line is the how-to. Exactly one shows, so the
  // control never changes height as you record. `chord-hint` marks the ARMED one only.
  const armedHint = hint ?? 'Press the chord now. Escape cancels.'

  return (
    <div className={styles.recorder}>
      <button
        type="button"
        className={[
          styles.recorderButton,
          armed ? styles.recorderArmed : '',
          !armed && value.length > 0 ? styles.recorderSet : ''
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid="chord-recorder"
        aria-label="Record a keyboard chord sequence"
        onClick={() => {
          // Arming always starts from an empty sequence, so re-recording REPLACES the old value.
          setArmed(true)
          setCaptured([])
          setHint(null)
        }}
        onBlur={disarm}
        onKeyDown={handleKeyDown}
      >
        {armed ? (
          captured.length === 0 ? (
            'Press a chord…'
          ) : (
            <>
              <ChordKeys keys={captured} />
              {' …'}
            </>
          )
        ) : value.length === 0 ? (
          'Set chord'
        ) : (
          <ChordKeys keys={value} />
        )}
      </button>
      {armed ? (
        <span className={styles.recorderHint} data-testid="chord-hint" role="status">
          {armedHint}
        </span>
      ) : (
        <span className={styles.fieldHelp}>{RESTING_HELP}</span>
      )}
    </div>
  )
}
