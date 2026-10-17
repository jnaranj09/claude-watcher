// ArrowDown / ArrowUp move focus between the rows of ONE menu (spec 2026-10-16 §3: "arrows move
// rows"). The caller's keydown handler on the anchor calls it, so a menu and the submenu nested
// inside it each keep their own rows: a row belongs to the nearest `role="menu"` around it. It
// stops at the first and last row, like `+ New session`'s menu. A leaving (inert) copy is skipped.
import type { KeyboardEvent } from 'react'

const ROW = '[role^="menuitem"]'

/** Handles ArrowDown / ArrowUp on a menu row; returns true when it moved (or held) focus. */
export function moveMenuRow(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false
  if (!(e.target instanceof HTMLElement) || !e.target.matches(ROW)) return false
  const menu = e.target.closest('[role="menu"]')
  if (menu === null) return false
  e.preventDefault()
  const rows = [...menu.querySelectorAll<HTMLElement>(ROW)].filter(
    (row) => row.closest('[role="menu"]') === menu && row.closest('[inert]') === null
  )
  const next = rows[rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1)]
  next?.focus()
  return true
}
