// Lucide icons (ISC licence), inline like PinIcon and the ☰ menu icons: no icon dependency. One
// component for every lucide icon the app draws, so the 14px stroke box is written once. Drawn on
// lucide's 24 grid, so the 2.25 stroke at 14px matches the menu icons' 1.5 stroke on a 16 grid.
// `currentColor` follows the text ramp. Decorative: the host control names itself.
import type { JSX } from 'react'

export type LucideIconName = 'layers' | 'rotate-ccw' | 'arrow-up-right'

const PATHS: Readonly<Record<LucideIconName, JSX.Element>> = {
  layers: (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </>
  ),
  'rotate-ccw': (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  'arrow-up-right': (
    <>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </>
  )
}

export function LucideIcon({ name }: { name: LucideIconName }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
