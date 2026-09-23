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
import type { ButtonHTMLAttributes, JSX, Ref } from 'react'
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
  return (
    <button
      {...rest}
      ref={buttonRef}
      type={type}
      className={className}
      data-testid={testId}
      data-variant={variant}
      data-size={size}
      {...(armed ? { 'data-armed': true } : {})}
      {...(lit ? { 'data-lit': true } : {})}
    >
      {children}
    </button>
  )
}
