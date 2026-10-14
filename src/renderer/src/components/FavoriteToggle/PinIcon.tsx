// Favorites — the pin: a flat pushpin tilted 45° (owner, 2026-10-13, option D), the shape apps use
// for "pinned". Inline SVG like the ☰ menu icons, no icon dependency; drawn on a 24 grid, so its
// 2.25 stroke at 14px matches their 1.5 stroke on a 16 grid. `currentColor` follows the text ramp.
// Its SHAPE is the state (outline off, filled on), so the toggle never also gets `lit`
// (technical-taste §16 exception, owner 2026-10-13).
import type { JSX } from 'react'

export function PinIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="rotate(45 12 12)"
      >
        <path d="M9 4v6l-2 4v2h10v-2l-2-4V4z" fill={filled ? 'currentColor' : 'none'} />
        <path d="M12 16v5M8 4h8" />
      </g>
    </svg>
  )
}
