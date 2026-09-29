// The project's ONE dropdown (.claude/rules/design.md). A native <select> is BANNED here: on
// Linux, Chromium draws its popup list from the desktop's GTK theme, not from the page, so on a
// light desktop it drops a white list with a blue highlight over this dark app. Neither
// `:root { color-scheme: dark }` nor `nativeTheme.themeSource = 'dark'` changes that — both were
// tried and the popup stayed light. A popup we render ourselves is the only one we can style.
//
// The popover mechanics mirror WorkspaceSwitcher.tsx (mousedown-outside closes; Escape closes and
// returns focus to the trigger, stopping propagation so it peels ONE layer and never closes the
// dialog behind it — UX-DR14). Arrow-key roving focus is ADDED here, which the switcher does not
// have: this replaces a control that had arrows natively, and shipping it without them would be
// an a11y regression, not a matched bar.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import styles from './Select.module.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** Optional leading element — the workspace swatch, for the scope dropdowns. */
  adornment?: ReactNode
}

export interface SelectProps<T extends string> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (next: T) => void
  /** Names the control for assistive tech — there is no `<label for>` seam on a button. */
  ariaLabel: string
  /** The trigger's testid. Each option gets `<testId>-option-<value>`. */
  testId: string
  /** `field` fills a form row; `inline` is compact chrome (a dialog header). */
  variant?: 'field' | 'inline'
  /** Which trigger edge the popup lines up with. `end` for a control at the right edge of its
   *  column (the Settings rows): a popup wider than the trigger would otherwise run past it. */
  align?: 'start' | 'end'
  disabled?: boolean
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
  variant = 'field',
  align = 'start',
  disabled = false
}: SelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex === -1 ? null : options[selectedIndex]

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Focus follows the OPEN, not the render: opening with the selected row focused is what makes
  // the arrow keys start from where the operator already is.
  useEffect(() => {
    if (!open) return
    const start = selectedIndex === -1 ? 0 : selectedIndex
    optionRefs.current[start]?.focus()
  }, [open, selectedIndex])

  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  function commit(next: T): void {
    closeAndRefocus()
    onChange(next)
  }

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    // ArrowDown/ArrowUp open the list, the way a native select does. Enter and Space already
    // reach onClick as a button activation, so they are not handled again here.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeAndRefocus()
      return
    }
    const focused = optionRefs.current.findIndex((el) => el === document.activeElement)
    const last = options.length - 1
    let next: number | null = null
    if (e.key === 'ArrowDown') next = focused >= last ? 0 : focused + 1
    else if (e.key === 'ArrowUp') next = focused <= 0 ? last : focused - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    optionRefs.current[next]?.focus()
  }

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.trigger} ${variant === 'inline' ? styles.inline : styles.field}`}
        data-testid={testId}
        // The chosen VALUE, for tests and for anything that needs it without parsing the label.
        // A native <select> exposed `.value`; a button has no equivalent, and asserting on the
        // rendered label instead would make every test depend on copy.
        data-value={value}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        {selected?.adornment}
        <span className={styles.label}>{selected?.label ?? ''}</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className={align === 'end' ? `${styles.list} ${styles.listEnd}` : styles.list}
          role="listbox"
          aria-label={ariaLabel}
          data-testid={`${testId}-list`}
          onKeyDown={handleListKeyDown}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              ref={(el) => {
                optionRefs.current[i] = el
              }}
              className={styles.option}
              role="option"
              aria-selected={o.value === value}
              data-testid={`${testId}-option-${o.value}`}
              data-value={o.value}
              onClick={() => commit(o.value)}
            >
              {o.adornment}
              <span className={styles.label}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
