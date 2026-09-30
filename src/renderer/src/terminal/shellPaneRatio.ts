// Card shell pane (spec 2026-09-30) — the divider's arithmetic, PURE. The ratio is the SHELL's
// share of the frame's height (0.3 = the shell takes 30%). Two clamps apply: the settings band
// (0.15–0.85, what the file accepts) and 80px per side (what a terminal can still show a prompt
// in). When the frame is too short for two 80px halves the pixel clamp would cross, so only the
// band applies then.
import { SHELL_PANE_RATIO_MAX, SHELL_PANE_RATIO_MIN } from '../../../shared/schemas/settings'

export const SHELL_PANE_MIN_PX = 80
export const SHELL_PANE_KEY_STEP = 0.05
/** The divider's own height between the two halves: 6px + 2 × --space-1 (SplitDivider.module.css,
 *  pinned by its test). Claude's 80px minimum is measured AFTER it, or the frame overflows and
 *  `overflow: clip` cuts the shell's bottom row (its prompt) at the top drag limit. */
export const SHELL_DIVIDER_PX = 14

export function clampShellRatio(ratio: number, frameHeightPx: number): number {
  let lo = SHELL_PANE_RATIO_MIN
  let hi = SHELL_PANE_RATIO_MAX
  if (frameHeightPx >= 2 * SHELL_PANE_MIN_PX + SHELL_DIVIDER_PX) {
    lo = Math.max(lo, SHELL_PANE_MIN_PX / frameHeightPx)
    hi = Math.min(hi, 1 - (SHELL_PANE_MIN_PX + SHELL_DIVIDER_PX) / frameHeightPx)
  }
  if (!Number.isFinite(ratio)) return lo
  return Math.min(hi, Math.max(lo, ratio))
}

/** The shell's share for a pointer at `clientY` over the frame's content box. Unclamped. */
export function ratioFromPointer(clientY: number, bounds: { top: number; height: number }): number {
  if (bounds.height <= 0) return 0
  return (bounds.top + bounds.height - clientY) / bounds.height
}

/** ArrowUp moves the divider up (the shell grows); ArrowDown the reverse. */
export function stepShellRatio(
  ratio: number,
  key: 'ArrowUp' | 'ArrowDown',
  frameHeightPx: number
): number {
  const delta = key === 'ArrowUp' ? SHELL_PANE_KEY_STEP : -SHELL_PANE_KEY_STEP
  return clampShellRatio(ratio + delta, frameHeightPx)
}

export function shellPercent(ratio: number): number {
  return Math.round(ratio * 100)
}
