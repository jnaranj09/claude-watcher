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
import type { JSX, KeyboardEvent, ReactNode, Ref } from 'react'
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
  /** A value the operator reads and copies but must not edit (the API token). NOT `disabled` —
   *  a disabled field is dimmed and cannot be selected, so its value cannot be copied by hand. */
  readOnly?: boolean | undefined
  /** The on-screen keyboard/IME hint for a field that only takes digits (the API port). */
  inputMode?: 'numeric' | undefined
  /** Commit-on-blur, for a field the caller validates before it writes (the API port). */
  onBlur?: (() => void) | undefined
  /** The caller keeps the ref — focus-on-open lives with whoever opens the surface. */
  inputRef?: Ref<HTMLInputElement> | undefined
  /** Joins the enclosing menu's roving focus (its `[data-menu-item]` query). */
  menuItem?: boolean | undefined
  /** `field` fills a form row; `inline` is compact chrome (a dialog header) — Select's two variants,
   *  and the same two boxes, so a text field and a dropdown standing side by side match. `toolbar` is
   *  the board filter bar's 32px row (the search box beside the `Filter` button); a dropdown that
   *  joins that row needs the same size in Select. */
  variant?: 'field' | 'inline' | 'toolbar' | undefined
  /** A leading glyph drawn inside the box (the board search's magnifier). Decorative only: the
   *  field is still named by `id` or `ariaLabel`. */
  icon?: ReactNode
  /** Keys the caller handles itself (the board search clears on Escape). */
  onKeyDown?: ((e: KeyboardEvent<HTMLInputElement>) => void) | undefined
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
  readOnly,
  inputMode,
  inputRef,
  menuItem,
  variant = 'field',
  icon,
  onKeyDown,
  onBlur
}: TextInputProps): JSX.Element {
  const className = [
    styles.input,
    variant === 'inline' ? styles.inline : variant === 'toolbar' ? styles.toolbar : null,
    icon !== undefined ? styles.withIcon : null
  ]
    .filter(Boolean)
    .join(' ')
  const input = (
    <input
      ref={inputRef}
      type="text"
      className={className}
      id={id}
      data-testid={testId}
      {...(menuItem === true ? { 'data-menu-item': true } : {})}
      aria-label={ariaLabel}
      aria-invalid={invalid === true ? true : undefined}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled === true}
      readOnly={readOnly === true}
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  )
  if (icon === undefined) return input
  return (
    <span className={styles.iconField}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {input}
    </span>
  )
}
