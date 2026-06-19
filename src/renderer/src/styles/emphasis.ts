// Story 1.3 — shared Needs-you emphasis primitives (AC-7, AC-8).
//
// Defined ONCE here and exported so Epic 2 (attention engine / rail) and Epic 3
// consume them rather than re-authoring (SM-C1 enforceability):
//   - the gold token reference (`NEEDS_YOU_TOKEN`),
//   - the pulse class hook (`needsYouEmphasisClass`) — the keyframe + the
//     `prefers-reduced-motion: reduce` fallback (no pulse, static fill + size) live
//     in `emphasis.module.css` (opacity 1.0↔0.78 + scale 1.0↔1.015, ~1.5s ease,
//     compositor-only).
//
// The `aria-live="polite"` announcer helper is `LiveAnnouncer` in
// `./LiveAnnouncer.tsx` (kept in its own file so this primitives module exports no
// component — react-refresh wants component files to export ONLY components).
//
// These are EXPORTED primitives, NOT consumed into a live rail here (the rail is
// Epic 3; the live attention wiring is Epic 2). [Dev Notes; UX-DR27/UX-DR29]
import emphasisStyles from './emphasis.module.css'

export { emphasisStyles }

/**
 * The CSS var reference for the one reserved alert hue (gold). Use this so every
 * emphasis surface points at the SAME token — gold stays the single hot hue.
 */
export const NEEDS_YOU_TOKEN = 'var(--needs-you)' as const

/**
 * The class name for the subtle Needs-you pulse (the keyframe + reduced-motion
 * fallback live in `emphasis.module.css`). Apply to a gold-anchored element that
 * should pulse on a genuine needs-you signal.
 */
export const needsYouEmphasisClass: string = emphasisStyles.needsYouEmphasis ?? ''
