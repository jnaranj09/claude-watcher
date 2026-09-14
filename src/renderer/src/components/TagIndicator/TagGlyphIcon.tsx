// Tags — the ONE tag glyph icon (outline + dot), shared by every button-sized tag affordance: the
// board card's `Tags…` menu trigger (Task 11), the rail's Tags… affordance (Task 12) and the header
// tags-menu button (TagsMenu). Reuses `TAG_GLYPH_PATH` (the same outline `TagIndicator` strokes) so
// every "tag" mark in the app is the same shape (spec T-7 — never a circle).
//
// A `.tsx` that exports ONLY this component — `TAG_GLYPH_PATH` itself stays in the sibling
// `tagGlyph.ts` (react-refresh only allows non-component exports from a plain `.ts` module).
import type { JSX } from 'react'
import { TAG_GLYPH_PATH } from './tagGlyph'

export interface TagGlyphIconProps {
  /** Pixel size of the (square) glyph box. Default 12 — the card affordance size. */
  size?: number
  className?: string
  /** The glyph is decorative by default; the host button/control names itself. Set false only
   *  when no accessible name exists anywhere else. */
  ariaHidden?: boolean
  /** Stroke weight. Default 1.5 (the card affordance weight); the rail's smaller 10px toggle
   *  (Task 12) wants a touch thicker so the outline does not thin away at that size. */
  strokeWidth?: number
}

export function TagGlyphIcon({
  size = 12,
  className,
  ariaHidden = true,
  strokeWidth = 1.5
}: TagGlyphIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      {...(className !== undefined ? { className } : {})}
    >
      <path d={TAG_GLYPH_PATH} />
      <circle cx="5.3" cy="5.3" r="1" />
    </svg>
  )
}
