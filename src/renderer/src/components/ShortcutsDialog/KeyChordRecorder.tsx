// Phrase shortcuts — the "press a chord" control. While armed it swallows the keydown entirely
// (preventDefault + stopPropagation) so recording can never fire an app binding or leak into a
// terminal. Only Ctrl+Shift+<A-Z> is accepted (spec S-2); reserved letters are refused with a
// reason the operator can act on.
import { useState, type JSX, type KeyboardEvent } from 'react'
import { chordFromEvent, chordProblem } from './shortcutForm'
import styles from './ShortcutsDialog.module.css'

export interface KeyChordRecorderProps {
  value: string
  onChange: (keys: string) => void
}

export function KeyChordRecorder({ value, onChange }: KeyChordRecorderProps): JSX.Element {
  const [armed, setArmed] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!armed) return
    // Never let a recording keystroke escape to the app or a terminal.
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setArmed(false)
      setHint(null)
      return
    }
    const chord = chordFromEvent(e.nativeEvent)
    if (chord === null) {
      setHint('Hold Ctrl+Shift and press a letter.')
      return
    }
    if (chordProblem(chord) === 'reserved') {
      setHint(`${chord} is reserved by the app. Pick another letter.`)
      return
    }
    onChange(chord)
    setArmed(false)
    setHint(null)
  }

  return (
    <div className={styles.recorder}>
      <button
        type="button"
        className={styles.recorderButton}
        data-testid="chord-recorder"
        aria-label="Record a keyboard chord"
        onClick={() => {
          setArmed(true)
          setHint(null)
        }}
        onBlur={() => {
          setArmed(false)
          setHint(null)
        }}
        onKeyDown={handleKeyDown}
      >
        {armed ? 'Press a chord…' : value || 'Set chord'}
      </button>
      {hint !== null && (
        <span className={styles.recorderHint} data-testid="chord-hint" role="status">
          {hint}
        </span>
      )}
    </div>
  )
}
