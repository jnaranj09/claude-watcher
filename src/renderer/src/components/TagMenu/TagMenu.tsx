// TagMenu — the ONE drawing of a tag list popup (2026-09-29): the board filter's tag list and the
// TagPicker (a board card's `Tags…`, the rail peek's `+ tag`). They were two looks — chips on the
// filter, bare names beside native checkboxes on the picker, which the desktop theme painted white
// — and the operator liked the filter's. Both callers render these parts, so the look lives in
// Popover (spec 2026-10-01); `TagMenu.test.tsx` fails if a caller grows its own.
//
// It draws, it does not behave: the roles, the keys and the closing stay with each caller (the
// filter is a single-choice `menu`, the picker a checkbox `group`). Themes reach both through
// `[data-popover]` / `[data-popover-item]` (Popover), so a theme cannot style one and miss the other.
import type { JSX, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { Popover } from '../Popover/Popover'
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
    <div className={`${styles.wrap} ${align === 'end' ? styles.alignEnd : styles.alignStart}`}>
      <Popover.Surface
        role={role}
        aria-label={ariaLabel}
        testId={testId}
        {...(id !== undefined ? { id } : {})}
        onKeyDown={onKeyDown}
        onClick={onClick}
      >
        <Popover.List>{children}</Popover.List>
      </Popover.Surface>
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
    <Popover.Item role={role} aria-checked={checked} testId={testId} onClick={onClick}>
      <TagChip tag={tag} />
      {checked && (
        <Popover.ItemEnd>
          <span className={styles.check} data-testid="tag-menu-check" aria-hidden="true">
            ✓
          </span>
        </Popover.ItemEnd>
      )}
    </Popover.Item>
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
  return <Popover.Note testId={testId}>{children}</Popover.Note>
}
