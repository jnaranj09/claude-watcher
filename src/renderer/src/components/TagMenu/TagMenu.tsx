// TagMenu — the ONE drawing of a tag list popup (2026-09-29): the board filter's tag list and the
// TagPicker (a board card's `Tags…`, the rail peek's `+ tag`). They were two looks — chips on the
// filter, bare names beside native checkboxes on the picker, which the desktop theme painted white
// — and the operator liked the filter's. Both callers render these parts, so the look lives in
// TagMenu.module.css alone; `TagMenu.test.tsx` fails if a caller grows its own.
//
// It draws, it does not behave: the roles, the keys and the closing stay with each caller (the
// filter is a single-choice `menu`, the picker a checkbox `group`). Themes reach both through
// `[data-tag-menu]` / `[data-tag-menu-row]`, so a theme cannot style one and miss the other.
import type { JSX, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { TagChip } from '../TagChip/TagChip'
import styles from './TagMenu.module.css'

export interface TagMenuProps {
  /** Which edge of the anchor it lines up with: the filter opens under its pill (`start`), the
   *  picker under a button at a card's or rail row's right edge (`end`). */
  align: 'start' | 'end'
  role: 'menu' | 'group'
  ariaLabel: string
  testId?: string | undefined
  id?: string | undefined
  onKeyDown?: ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined
  onClick?: ((e: MouseEvent<HTMLDivElement>) => void) | undefined
  children: ReactNode
}

export function TagMenu({
  align,
  role,
  ariaLabel,
  testId,
  id,
  onKeyDown,
  onClick,
  children
}: TagMenuProps): JSX.Element {
  return (
    <div
      className={`${styles.menu} ${align === 'end' ? styles.alignEnd : styles.alignStart}`}
      data-tag-menu
      role={role}
      aria-label={ariaLabel}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      {...(id !== undefined ? { id } : {})}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export interface TagMenuRowProps {
  tag: Pick<Tag, 'id' | 'name' | 'color'>
  /** Carries the tag now: the row is outlined and shows the ✓. */
  checked: boolean
  /** `menuitemradio` in the filter (one tag at a time), `checkbox` in the picker (any number). */
  role: 'menuitemradio' | 'checkbox'
  testId: string
  onClick: () => void
}

/** One tag: its chip, and a ✓ at the right edge while it is on. A menu row, not a Button
 *  (design.md: menu / list rows keep their own rules). */
export function TagMenuRow({ tag, checked, role, testId, onClick }: TagMenuRowProps): JSX.Element {
  return (
    <button
      type="button"
      className={styles.row}
      data-tag-menu-row
      role={role}
      aria-checked={checked}
      data-testid={testId}
      onClick={onClick}
    >
      <TagChip tag={tag} />
      {checked && (
        <span className={styles.check} data-testid="tag-menu-check" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )
}

/** A line of text in the list (nothing to offer yet). */
export function TagMenuNote({
  testId,
  children
}: {
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <p className={styles.note} data-testid={testId}>
      {children}
    </p>
  )
}
