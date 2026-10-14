// Favorites — the star. Inline SVG like the ☰ menu icons (16 grid, 1.5 stroke, 14px), no icon
// dependency; `currentColor` follows the text ramp. Its SHAPE is the state (outline off, filled
// on), so the toggle never also gets `lit` (technical-taste §16 exception, owner 2026-10-13).
import type { JSX } from 'react'

export function StarIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
