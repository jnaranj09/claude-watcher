// Story 1.3 — shared Needs-you emphasis primitives (AC-7, AC-8).
//
// Defined ONCE here and exported so Epic 2 (attention engine / rail) and Epic 3
// consume them rather than re-authoring (SM-C1 enforceability):
//   - the pulse class hook (`needsYouEmphasisClass`) — the keyframe + the
//     `prefers-reduced-motion: reduce` fallback (no motion, no residual transform)
//     live in `emphasis.module.css` (a whole-pixel translateY bounce on a 2.4s
//     cycle, compositor-only; it never scales — see that file's header).
// The gold itself is the `--needs-you` CSS token, read in CSS directly.
//
// The `aria-live="polite"` announcer helper is `LiveAnnouncer` in
// `./LiveAnnouncer.tsx` (kept in its own file so this primitives module exports no
// component — react-refresh wants component files to export ONLY components).
//
// These are EXPORTED primitives, NOT consumed into a live rail here (the rail is
// Epic 3; the live attention wiring is Epic 2). [Dev Notes; UX-DR27/UX-DR29]
import emphasisStyles from './emphasis.module.css'

/**
 * The class name for the subtle Needs-you pulse (the keyframe + reduced-motion
 * fallback live in `emphasis.module.css`). Apply to a gold-anchored element that
 * should pulse on a genuine needs-you signal.
 */
export const needsYouEmphasisClass: string = emphasisStyles.needsYouEmphasis ?? ''
