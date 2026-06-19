// Story 1.3 — the aria-live announcer helper (AC-7, AC-8).
//
// A tiny visually-hidden `aria-live="polite"` region (UX-DR29). Mount it once;
// update `message` to announce a needs-you transition non-visually. It is NOT wired
// to live attention events here — Epic 2 drives the message. Visually hidden via the
// global `.sr-only` utility (defined in assets/main.css).
//
// Kept in its own file (not in `emphasis.ts`) so the primitives module exports no
// component (react-refresh: component files export ONLY components).
import type { JSX } from 'react'

export interface LiveAnnouncerProps {
  /** The message to announce. Changing it re-announces (politely). */
  message?: string
}

export function LiveAnnouncer({ message = '' }: LiveAnnouncerProps): JSX.Element {
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-announcer"
    >
      {message}
    </div>
  )
}
