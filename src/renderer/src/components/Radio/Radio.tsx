// The radio button: one choice of a group (today the workspace colour). A native radio with
// `appearance: none`, so the browser keeps the arrow keys, the group and the change event; this
// file owns only the look: a circle that is lit when picked, never the native blue. What it names
// sits beside it, `--gap-field` away, in the caller's <label> (design.md, label → its control).
import type { JSX } from 'react'
import styles from './Radio.module.css'

export interface RadioProps {
  /** The group: one radio of a name is picked at a time. */
  name: string
  value: string
  checked: boolean
  /** Called when this radio becomes the picked one. */
  onChange: () => void
  ariaLabel: string
  testId?: string
}

export function Radio({
  name,
  value,
  checked,
  onChange,
  ariaLabel,
  testId
}: RadioProps): JSX.Element {
  return (
    <input
      type="radio"
      className={styles.dot}
      name={name}
      value={value}
      aria-label={ariaLabel}
      data-testid={testId}
      checked={checked}
      onChange={onChange}
    />
  )
}
