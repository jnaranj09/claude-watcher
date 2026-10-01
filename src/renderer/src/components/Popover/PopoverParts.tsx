// Popover — the ONE drawing of a menu / list popup (spec 2026-10-01-popover-standard-design.md).
//
// Ten popovers each drew their own box and rows, and they had drifted (three selected looks, two
// radii, two paddings), and a theme could reach the boxes only by role and test id and the rows
// not at all. These parts own the LOOK and the theme hooks — `data-popover`, `data-popover-list`,
// `data-popover-item`, `data-popover-divider` — and nothing else: roles, ARIA state, keys,
// open/close and POSITION stay with each caller. A caller positions a wrapper and renders
// `Popover.Surface` inside it; no part takes a `className` (the Button rule).
//
// Row states come from the ARIA the caller already sets (`aria-selected`, `aria-checked`,
// `aria-expanded`) so the visible state and the accessible one cannot disagree. `active` is the
// one exception: the expander's highlighted row follows its own index, not focus.
import type { ButtonHTMLAttributes, HTMLAttributes, JSX, ReactNode, Ref } from 'react'
import { workspaceTintClass, type WorkspaceTone } from '../WorkspaceTint/workspaceTint'
import styles from './Popover.module.css'

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style'>

export interface PopoverSurfaceProps extends DivProps {
  testId?: string | undefined
  surfaceRef?: Ref<HTMLDivElement> | undefined
  children: ReactNode
}

/** The box. It never scrolls: a submenu positioned inside it would be clipped. */
export function PopoverSurface({
  testId,
  surfaceRef,
  children,
  ...rest
}: PopoverSurfaceProps): JSX.Element {
  return (
    <div
      {...rest}
      ref={surfaceRef}
      className={styles.surface}
      data-popover=""
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {children}
    </div>
  )
}

export interface PopoverListProps extends DivProps {
  testId?: string | undefined
  listRef?: Ref<HTMLDivElement> | undefined
  children: ReactNode
}

/** Rows with no box of their own — the scrolling part. Its cap is `--popover-max-height`, set by
 *  the caller's wrapper (a custom property inherits). */
export function PopoverList({ testId, listRef, children, ...rest }: PopoverListProps): JSX.Element {
  return (
    <div
      {...rest}
      ref={listRef}
      className={styles.list}
      data-popover-list=""
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {children}
    </div>
  )
}

export interface PopoverItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'type'
> {
  testId?: string | undefined
  buttonRef?: Ref<HTMLButtonElement> | undefined
  /** A workspace's tint (WorkspaceTint is the one tone → colour mapping). */
  tone?: WorkspaceTone | undefined
  /** The keyboard-highlighted row of a list whose focus stays elsewhere (the expander). */
  active?: boolean | undefined
  children: ReactNode
}

function row(
  variant: { 'data-density'?: 'compact'; 'data-quiet'?: '' },
  { testId, buttonRef, tone, active = false, children, ...rest }: PopoverItemProps
): JSX.Element {
  const className = tone === undefined ? styles.item : `${styles.item} ${workspaceTintClass(tone)}`
  return (
    <button
      {...rest}
      ref={buttonRef}
      type="button"
      className={className}
      data-popover-item=""
      {...variant}
      {...(tone !== undefined ? { 'data-tone': tone } : {})}
      {...(active ? { 'data-active': '' } : {})}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {children}
    </button>
  )
}

export function PopoverItem(props: PopoverItemProps): JSX.Element {
  return row({}, props)
}
/** The tighter row: the card's move menu, the terminal's Copy / Paste, the expander. */
export function PopoverCompactItem(props: PopoverItemProps): JSX.Element {
  return row({ 'data-density': 'compact' }, props)
}
/** A secondary action at the end of a list (`Manage workspaces…`, `Create tags…`). */
export function PopoverQuietItem(props: PopoverItemProps): JSX.Element {
  return row({ 'data-quiet': '' }, props)
}

export function PopoverItemIcon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className={styles.icon} aria-hidden="true">
      {children}
    </span>
  )
}

export function PopoverItemEnd({ children }: { children: ReactNode }): JSX.Element {
  return <span className={styles.end}>{children}</span>
}

export function PopoverDivider(): JSX.Element {
  return <div className={styles.divider} role="separator" data-popover-divider="" />
}

export function PopoverNote({
  testId,
  children
}: {
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <p className={styles.note} data-popover-note="" data-testid={testId}>
      {children}
    </p>
  )
}
