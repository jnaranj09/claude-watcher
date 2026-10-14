// Favorites — the ONE star toggle (Manage rows and the + New session popover). A ghost icon
// button (§16: ghost is for icons inside a row), `aria-pressed` for the state, `data-favorite`
// as the public theme hook. Never `lit`: the filled star is the on look (owner, 2026-10-13).
import type { JSX } from 'react'
import { Button } from '../Button/Button'
import { FAVORITE_TERMS } from '../../copy/terms'
import { StarIcon } from './StarIcon'

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
  return (
    <Button
      variant="ghost"
      size="xs"
      icon
      testId={testId}
      aria-label={`${FAVORITE_TERMS.label} ${name}`}
      title={FAVORITE_TERMS.label}
      aria-pressed={favorite}
      data-favorite={favorite ? 'on' : 'off'}
      busy={busy}
      onClick={onToggle}
    >
      <StarIcon filled={favorite} />
    </Button>
  )
}
