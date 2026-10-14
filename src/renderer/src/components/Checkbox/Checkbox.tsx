// The checkbox that SELECTS things (row checks, Select all, Include global); an on/off setting is
// `components/Switch`. A native checkbox with `appearance: none`, so the browser keeps Space, the
// label and the change event; this file owns only the look: a square that is lit when on, never
// the native blue. An <input> draws no ::before, so the mark is an SVG laid over the box.
import { useEffect, useRef, type JSX } from 'react'
import styles from './Checkbox.module.css'

interface CheckboxBase {
  checked: boolean
  /** Gets the NEW value. */
  onChange: (checked: boolean) => void
  /** Some, not all, of what it selects is selected: draws a dash. */
  indeterminate?: boolean
  testId?: string
}
/** Visible text (drawn `--gap-field` after the box, and a click on it toggles), or, for a box
 *  whose meaning the row beside it shows, an accessible name only. */
export type CheckboxProps = CheckboxBase &
  ({ label: string; ariaLabel?: never } | { ariaLabel: string; label?: never })

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  testId,
  label,
  ariaLabel
}: CheckboxProps): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null)
  // `indeterminate` is a DOM property with no attribute: set it imperatively.
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  const box = (
    <span className={styles.box}>
      <input
        ref={ref}
        type="checkbox"
        className={styles.square}
        data-testid={testId}
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <svg className={styles.mark} viewBox="0 0 16 16" aria-hidden="true">
        <path className={styles.tick} d="M4 8.2l2.6 2.6L12 5.4" />
        <path className={styles.dash} d="M4.5 8h7" />
      </svg>
    </span>
  )
  if (label === undefined) return box
  return (
    <label className={styles.labeled}>
      {box}
      <span>{label}</span>
    </label>
  )
}
