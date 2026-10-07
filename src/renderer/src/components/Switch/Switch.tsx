// The ONE on/off control for settings (spec 2026-10-07 A.6). A native checkbox with
// `appearance: none`: the browser keeps Space, `<label htmlFor>` and the change event; this file
// owns only the look — a glass track, lit when on (the `lit` Button's fill), never the native
// blue. Checkboxes that SELECT things (row checks, Select all, Include global) stay checkboxes.
import type { JSX } from 'react'
import styles from './Switch.module.css'

export interface SwitchProps {
  /** Pairs with the caller's `<label htmlFor>`. */
  id: string
  checked: boolean
  /** Gets the NEW value. */
  onChange: (checked: boolean) => void
  testId?: string
  disabled?: boolean
}

export function Switch({ id, checked, onChange, testId, disabled }: SwitchProps): JSX.Element {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      className={styles.switch}
      data-testid={testId}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}
