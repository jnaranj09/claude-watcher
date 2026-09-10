// The project's ONE single-line text field (.claude/rules/design.md).
//
// Five dialogs had each grown their own `.input` CSS rule and they had already drifted apart:
// two different backgrounds (--bg-surface vs --bg-base), a focus ring in some and not others,
// a ::placeholder colour in exactly one. Deleting one of those blocks by accident silently
// dropped a field back to Chromium's own dark-scheme input, which is how this component came to
// exist. One component, one box.
//
// It renders the FIELD only — the <label>, the helper line and the error line stay at the call
// site, because their layout differs per dialog and the error line is one-per-dialog by rule.
import type { JSX, Ref } from 'react'
import styles from './TextInput.module.css'

export interface TextInputProps {
  /** Always controlled — there is no uncontrolled variant. */
  value: string
  onChange: (next: string) => void
  /** `data-testid` on the input itself. */
  testId: string
  /** Set this when a `<label htmlFor>` names the field; otherwise pass `ariaLabel`. */
  id?: string | undefined
  ariaLabel?: string | undefined
  placeholder?: string | undefined
  maxLength?: number | undefined
  /** Marks the current value as rejected. The dialog still owns the error LINE. */
  invalid?: boolean | undefined
  disabled?: boolean | undefined
  /** The caller keeps the ref — focus-on-open lives with whoever opens the surface. */
  inputRef?: Ref<HTMLInputElement> | undefined
  /** Joins the enclosing menu's roving focus (its `[data-menu-item]` query). */
  menuItem?: boolean | undefined
}

export function TextInput({
  value,
  onChange,
  testId,
  id,
  ariaLabel,
  placeholder,
  maxLength,
  invalid,
  disabled,
  inputRef,
  menuItem
}: TextInputProps): JSX.Element {
  return (
    <input
      ref={inputRef}
      type="text"
      className={styles.input}
      id={id}
      data-testid={testId}
      {...(menuItem === true ? { 'data-menu-item': true } : {})}
      aria-label={ariaLabel}
      aria-invalid={invalid === true ? true : undefined}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled === true}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
