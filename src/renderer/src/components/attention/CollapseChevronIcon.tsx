// The rail's collapse « / » as a drawn double chevron. The text glyph sat off-centre in the round
// button: a font puts « at its x-height, not the middle of the line box.
import type { JSX } from 'react'

export function CollapseChevronIcon({ pointing }: { pointing: 'left' | 'right' }): JSX.Element {
  return (
    <svg
      width={11}
      height={11}
      viewBox="1.2 0.6 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...(pointing === 'right' ? { transform: 'scale(-1 1)' } : {})}
    >
      <path d="M6.25 2.25 2.5 6l3.75 3.75M9.5 2.5 6 6l3.5 3.5" />
    </svg>
  )
}
