// The project's ONE multi-line text field (.claude/rules/design.md) — TextInput's box, taller.
//
// Same reason TextInput exists: a second `.textArea` rule in the next dialog's own CSS module is
// how the single-line box drifted into five different boxes. One component, one box — and
// `TextInput.test.tsx`'s structural walk fails if any other module declares `.textArea`.
//
// Like TextInput it renders the FIELD only — the <label>, the character counter and the dialog's
// one error line stay at the call site.
import type { JSX } from 'react'
import styles from './TextArea.module.css'

export interface TextAreaProps {
  /** Always controlled — there is no uncontrolled variant. */
  value: string
  onChange: (next: string) => void
  /** `data-testid` on the textarea itself. */
  testId: string
  /** Set this when a `<label htmlFor>` names the field; otherwise pass `ariaLabel`. */
  id?: string | undefined
  ariaLabel?: string | undefined
  placeholder?: string | undefined
  maxLength?: number | undefined
  /** Marks the current value as rejected. The dialog still owns the error LINE. */
  invalid?: boolean | undefined
  disabled?: boolean | undefined
  /** Visible lines at rest. The operator can still drag it taller (`resize: vertical`). */
  rows?: number | undefined
}

export function TextArea({
  value,
  onChange,
  testId,
  id,
  ariaLabel,
  placeholder,
  maxLength,
  invalid,
  disabled,
  rows = 4
}: TextAreaProps): JSX.Element {
  return (
    <textarea
      className={styles.textArea}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-invalid={invalid === true ? true : undefined}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled === true}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
