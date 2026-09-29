// Shortcut expander — the box that opens over the focused terminal on the expander chord.
//
// It owns the input, the match list and the highlight (plain React state — this is a form,
// not the terminal). It never touches xterm or the port: on Enter it hands the expanded
// TEXT to `onExpand` and the terminal writes it. Every failure stays here as the one error
// line; nothing partial ever leaves. Escape and focus-out call `onClose`.
import { useEffect, useRef, useState, type FocusEvent, type JSX, type KeyboardEvent } from 'react'
import type { Shortcut } from '../../../../shared/schemas/shortcut'
import {
  EXPANDER_MAX_ROWS,
  expandErrorCopy,
  expandInput,
  matchAliases,
  parseInput,
  type ExpandError
} from '../../shortcuts/expand'
import { TextInput } from '../TextInput/TextInput'
import styles from './ExpanderBox.module.css'

export interface ExpanderBoxProps {
  /** Global + active-workspace rows, the same set the terminal used to match chords on. */
  shortcuts: readonly Shortcut[]
  /** Success: the expanded text. The caller writes it and closes the box. */
  onExpand: (value: string) => void
  /** Escape, focus left the box, or — redundantly — a successful expand: `handleExpand`
   *  refocuses the terminal, which blurs the box and runs this same focus-out path. Both
   *  call sites are idempotent today, but "Nothing was written" is NOT implied by this call
   *  alone; check `onExpand` for that. */
  onClose: () => void
}

/** The input cap. The expanded RESULT has its own cap in expand.ts. */
const INPUT_MAX_LENGTH = 500

export function ExpanderBox({ shortcuts, onExpand, onClose }: ExpanderBoxProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [error, setError] = useState<ExpandError | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Whoever opens the surface owns the focus (design.md): this box opened, so it focuses.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The list filters on the FIRST word only; the rest of the input is the values.
  const { alias } = parseInput(query)
  const matches = matchAliases(alias, shortcuts).slice(0, EXPANDER_MAX_ROWS)
  const index = matches.length === 0 ? 0 : Math.min(highlight, matches.length - 1)
  const highlighted = matches[index] ?? null

  function handleChange(next: string): void {
    setQuery(next)
    setHighlight(0)
    setError(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      // Peel ONE layer (UX-DR14): the dialog/app behind must not also see this Escape.
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (matches.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((index + step + matches.length) % matches.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      // Fail closed on an empty query: an empty query matches EVERY shortcut (matchAliases),
      // so without this guard a stray Enter would expand the top row the operator never typed.
      if (alias === '') return
      const result = expandInput(query, shortcuts, highlighted?.alias)
      if (result.ok) onExpand(result.value)
      else setError(result.error)
    }
  }

  function handleFocusOut(e: FocusEvent<HTMLDivElement>): void {
    const next = e.relatedTarget
    if (next instanceof Node && rootRef.current?.contains(next)) return
    onClose()
  }

  return (
    <div
      ref={rootRef}
      className={styles.box}
      data-testid="expander-box"
      onKeyDown={handleKeyDown}
      onBlur={handleFocusOut}
    >
      <TextInput
        ariaLabel="Expand shortcut"
        testId="expander-input"
        placeholder='alias value "value with spaces"…'
        maxLength={INPUT_MAX_LENGTH}
        value={query}
        onChange={handleChange}
        invalid={error !== null}
        inputRef={inputRef}
      />
      {matches.length === 0 ? (
        <span className={styles.empty} data-testid="expander-empty">
          No shortcut matches
        </span>
      ) : (
        <div className={styles.list} role="listbox" aria-label="Matching shortcuts">
          {matches.map((s, i) => (
            <div
              key={s.id}
              role="option"
              aria-selected={i === index}
              className={i === index ? `${styles.row} ${styles.rowActive}` : styles.row}
              data-testid={`expander-option-${s.alias}`}
              // mousedown, not click: a click would first move focus out and close the box.
              onMouseDown={(e) => {
                e.preventDefault()
                setHighlight(i)
              }}
            >
              <span className={styles.alias}>{s.alias}</span>
              <span className={styles.name} title={s.name}>
                {s.name}
              </span>
              <span className={styles.text} title={s.text}>
                {s.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {error !== null && (
        <span className={styles.error} role="alert" data-testid="expander-error">
          {expandErrorCopy(error)}
        </span>
      )}
    </div>
  )
}
