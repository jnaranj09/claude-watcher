// The per-state human status text, kept OUT of StatusDot.tsx so the component file exports ONLY
// components (react-refresh/only-export-components — the same split as attention/railName.ts).
//
// ONE definition of "what a status is called". Both the dot's own label and any caller that has to
// fold the status into an `aria-label` read it from here, so the two can never drift apart.
//
// WHY A CALLER WOULD NEED IT: an element with its own `aria-label` (the rail row is a <button
// aria-label=…>) does NOT expose its inner text to assistive tech — the label REPLACES the
// contents. So a screen-reader-only status span nested inside such a button is never announced,
// and the status would end up conveyed by dot COLOR alone (the thing UX-DR29 forbids). Those
// callers must put the status text in their own label; this is where they get it.
import type { DotStatus } from './StatusDot'

/** Default human labels per state. */
export const STATUS_LABELS: Record<DotStatus, string> = {
  working: 'Working',
  'needs-you': 'Needs you',
  idle: 'Idle'
}

/** The human text for a live status state. */
export function statusLabel(status: DotStatus): string {
  return STATUS_LABELS[status]
}
