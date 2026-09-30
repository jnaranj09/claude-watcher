// Card shell pane (spec 2026-09-30) — the divider between a card's claude terminal and its shell.
// A `role="separator"` the keyboard can reach: ArrowUp/ArrowDown move it 5%, a double-click resets
// it. A pointer drag reports LIVE ratios (`onDrag`, the layout follows) and commits ONCE on release
// (`onCommit`, the caller saves it) — never a save per pointer move. All the arithmetic is the
// pure `terminal/shellPaneRatio.ts`; the frame's content box is injected (`getBounds`) because
// the divider must not know which element it splits.
import { useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import {
  DEFAULT_SHELL_PANE_RATIO,
  SHELL_PANE_RATIO_MAX,
  SHELL_PANE_RATIO_MIN
} from '../../../../shared/schemas/settings'
import {
  clampShellRatio,
  ratioFromPointer,
  shellPercent,
  stepShellRatio
} from '../../terminal/shellPaneRatio'
import styles from './SplitDivider.module.css'

export interface SplitDividerProps {
  /** The shell's share of the frame (0.15–0.85). */
  ratio: number
  /** The split frame's CONTENT box in viewport px, or null when it cannot be measured (no drag). */
  getBounds: () => { top: number; height: number } | null
  /** Live, during a drag. The caller applies it to the layout and saves nothing. */
  onDrag: (ratio: number) => void
  /** Drag end, a key step, a double-click reset — the ONE save point. */
  onCommit: (ratio: number) => void
  ariaLabel: string
  testId: string
}

export function SplitDivider({
  ratio,
  getBounds,
  onDrag,
  onCommit,
  ariaLabel,
  testId
}: SplitDividerProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  /** The ratio of the LAST move, committed on release (state would be one render behind). */
  const lastRef = useRef<number | null>(null)
  const boundsRef = useRef<{ top: number; height: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const bounds = getBounds()
    if (bounds === null) return
    boundsRef.current = bounds
    lastRef.current = null
    setDragging(true)
    // jsdom has no pointer capture; the real app keeps the drag while the pointer leaves the bar.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* not capturable — the drag still works while the pointer stays over the bar */
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const bounds = boundsRef.current
    if (!dragging || bounds === null) return
    const next = clampShellRatio(ratioFromPointer(e.clientY, bounds), bounds.height)
    lastRef.current = next
    onDrag(next)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
    const last = lastRef.current
    boundsRef.current = null
    lastRef.current = null
    if (last !== null) onCommit(last)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const height = getBounds()?.height ?? 0
    onCommit(stepShellRatio(ratio, e.key, height))
  }

  const onDoubleClick = (): void => {
    onCommit(DEFAULT_SHELL_PANE_RATIO)
  }

  return (
    <div
      className={styles.divider}
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-valuenow={shellPercent(ratio)}
      aria-valuemin={shellPercent(SHELL_PANE_RATIO_MIN)}
      aria-valuemax={shellPercent(SHELL_PANE_RATIO_MAX)}
      tabIndex={0}
      data-testid={testId}
      {...(dragging ? { 'data-dragging': true } : {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  )
}
