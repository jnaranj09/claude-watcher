// The project's ONE button (.claude/rules/design.md).
//
// Before it, nine button looks lived in the renderer and most were copies: the raised header
// button was pasted into four modules, the dialog Cancel/Confirm pair into three, the quiet
// outlined ☰ / ⚙ / ✕ into four with three different borders, and none of them set a height — the
// text sat on `padding: 4px 12px` and looked squeezed. One component, three sizes, four variants.
//
// It renders the BUTTON only. Where it sits (a footer's `flex-end`, a rail's `margin-top: auto`, a
// card's reveal-on-hover) is the call site's layout, on a wrapper — the button never takes a
// `className`, or the drift this replaces comes straight back through it.
import type { ButtonHTMLAttributes, JSX, ReactNode, Ref } from 'react'
import styles from './Button.module.css'

/** `primary` is the ONE main action of a surface (`+ New session`, Save). `secondary` is every
 *  other outlined control (☰, Back, Cancel, Filter). `danger` is red at rest and fills when armed
 *  (design.md's Delete). `ghost` is borderless: the icon buttons on cards, rows and dialog headers. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
/** Heights: `md` 32px (the header, the filter bar, dialog footers), `sm` 26px (pills, the rail),
 *  `xs` 20px (the icon buttons inside a card or a rail row). */
export type ButtonSize = 'md' | 'sm' | 'xs'

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'type'
> {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  /** A square holding only a glyph. It has no visible text, so it needs an `aria-label`. */
  icon?: boolean | undefined
  /** `danger` only: the armed second-press state — solid red, `Confirm delete`. */
  armed?: boolean | undefined
  /** A toggle that is ON (the Filter button while its row is open, an open rail peek):
   *  `--text-primary` fill, `--text-on-lit` ink. */
  lit?: boolean | undefined
  /** Defaults to `button`. Only a form's Save is `submit`. */
  type?: 'button' | 'submit' | undefined
  /** `data-testid` on the button itself. */
  testId: string
  /** The caller keeps the ref — refocus-after-close lives with whoever opened the surface. */
  buttonRef?: Ref<HTMLButtonElement> | undefined
  /** Action feedback (spec 2026-09-29 §1.3): the CONSTANT result text (`✓ Copied`). While set,
   *  the label and the result are BOTH rendered in one grid cell from the first paint — the one not
   *  shown is `visibility: hidden` — so the cell holds max(label, result) and the button never
   *  changes width. A hidden `role="status"` sibling is in the page from the start, so the result
   *  is announced when it shows. Omit it on a button that never reports a result. */
  feedback?: ReactNode | undefined
  /** Which layer is visible: the result (true) or the label. Drive it with `useFlash`:
   *  `feedbackShown={copied !== null}`. */
  feedbackShown?: boolean | undefined
  /** An action in flight: `disabled` + `aria-busy`. The caller may swap `children` for a busy
   *  label (`Starting…`). The double-submit guard itself is `useAsyncAction`. */
  busy?: boolean | undefined
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon = false,
  armed = false,
  lit = false,
  type = 'button',
  testId,
  buttonRef,
  feedback,
  feedbackShown = false,
  busy = false,
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const className = [
    styles.button,
    styles[variant],
    size === 'sm' ? styles.sm : size === 'xs' ? styles.xs : null,
    icon ? styles.icon : null
  ]
    .filter(Boolean)
    .join(' ')
  const hasFeedback = feedback !== undefined
  // Both layers ALWAYS, while a result exists: the cell is max(label, result) from the first paint.
  const label = hasFeedback ? (
    <span className={styles.swap}>
      <span
        className={feedbackShown ? styles.swapHidden : undefined}
        aria-hidden={feedbackShown ? true : undefined}
      >
        {children}
      </span>
      <span
        className={feedbackShown ? undefined : styles.swapHidden}
        aria-hidden={feedbackShown ? undefined : true}
      >
        {feedback}
      </span>
    </span>
  ) : (
    children
  )
  return (
    <>
      <button
        {...rest}
        ref={buttonRef}
        type={type}
        className={className}
        data-testid={testId}
        data-variant={variant}
        data-size={size}
        disabled={busy || disabled === true}
        {...(busy ? { 'aria-busy': true } : {})}
        {...(armed ? { 'data-armed': true } : {})}
        {...(lit ? { 'data-lit': true } : {})}
      >
        {label}
      </button>
      {/* A sibling, not a child: a live region inside a button is read as part of its name. The
          global `.sr-only` is position:absolute, so it takes no flex gap beside the button. */}
      {hasFeedback && (
        <span className="sr-only" role="status">
          {feedbackShown ? feedback : ''}
        </span>
      )}
    </>
  )
}
