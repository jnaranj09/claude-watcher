// Favorites — the ONE pin toggle (Manage rows and the + New session popover). A ghost icon
// button (§16: ghost is for icons inside a row), `aria-pressed` for the state, `data-favorite`
// as the public theme hook. Never `lit`: the filled pin is the on look (owner, 2026-10-13).
import { useLayoutEffect, useRef, type JSX } from 'react'
import { Button } from '../Button/Button'
import { FAVORITE_TERMS } from '../../copy/terms'
import { PinIcon } from './PinIcon'

export interface FavoriteToggleProps {
  /** The row's name — the accessible name is `Favorite <name>` (the `Rename <name>` pattern). */
  name: string
  favorite: boolean
  busy: boolean
  onToggle: () => void
  testId: string
}

export function FavoriteToggle({
  name,
  favorite,
  busy,
  onToggle,
  testId
}: FavoriteToggleProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // Focus follows the pin. Main's answer re-sorts the list, and Chromium drops focus from a row
  // React MOVES; on <body>, Escape and the arrow keys no longer reach the popover or dialog. So a
  // pin pressed while focused takes focus back once the answer lands (`busy` ends) — only when
  // focus was LOST (on <body>), never from a field the operator moved to meanwhile.
  const refocus = useRef(false)
  useLayoutEffect(() => {
    if (busy || !refocus.current) return
    refocus.current = false
    const active = document.activeElement
    if (active === null || active === document.body) buttonRef.current?.focus()
  }, [busy, favorite])
  return (
    <Button
      buttonRef={buttonRef}
      variant="ghost"
      size="xs"
      icon
      testId={testId}
      aria-label={`${FAVORITE_TERMS.label} ${name}`}
      title={FAVORITE_TERMS.label}
      aria-pressed={favorite}
      data-favorite={favorite ? 'on' : 'off'}
      busy={busy}
      onClick={() => {
        refocus.current = document.activeElement === buttonRef.current
        onToggle()
      }}
    >
      <PinIcon filled={favorite} />
    </Button>
  )
}
