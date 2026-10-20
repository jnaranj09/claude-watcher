// The app's ONE drag line between two panels: the card shell pane's split (spec 2026-09-30,
// `horizontal`: claude above, shell below) and the focused view's task panel edge (`vertical`:
// terminal left, tasks right). A `role="separator"` the keyboard can reach: the arrow keys along
// its axis step it, a double-click resets it. A pointer drag reports LIVE values (`onDrag`, the
// layout follows) and commits ONCE on release (`onCommit`, the caller saves it, if it saves) —
// never a save per pointer move. The divider knows no units: the caller turns a pointer position
// into a value (`startDrag`), a key into a step (`stepValue`), and names the reset value.
import { useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import styles from './SplitDivider.module.css'

export interface SplitDividerHandlers {
  /** Its value for screen readers (`aria-valuenow/min/max`). */
  valueNow: number
  valueMin: number
  valueMax: number
  /** A drag starts at `clientPos` (clientY for `horizontal`, clientX for `vertical`). Returns how
   *  a pointer position maps to a value for this drag, or null when nothing can be measured (no
   *  drag). */
  startDrag: (clientPos: number) => ((clientPos: number) => number) | null
  /** An arrow key along the axis: -1 = up / left, +1 = down / right. Returns the value to commit. */
  stepValue: (direction: -1 | 1) => number
  /** A double-click commits this. */
  resetValue: number
}

export interface SplitDividerProps extends SplitDividerHandlers {
  /** The line's direction: `horizontal` splits top / bottom, `vertical` left / right. */
  orientation: 'horizontal' | 'vertical'
  /** Live, during a drag. The caller applies it to the layout and saves nothing. */
  onDrag: (value: number) => void
  /** Drag end, a key step, a double-click reset — the ONE save point. */
  onCommit: (value: number) => void
  ariaLabel: string
  testId: string
}

const KEYS = {
  horizontal: { ArrowUp: -1, ArrowDown: 1 },
  vertical: { ArrowLeft: -1, ArrowRight: 1 }
} as const satisfies Record<string, Record<string, -1 | 1>>

export function SplitDivider({
  orientation,
  valueNow,
  valueMin,
  valueMax,
  startDrag,
  stepValue,
  resetValue,
  onDrag,
  onCommit,
  ariaLabel,
  testId
}: SplitDividerProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  /** The value of the LAST move, committed on release (state would be one render behind). */
  const lastRef = useRef<number | null>(null)
  const mapRef = useRef<((clientPos: number) => number) | null>(null)
  const posOf = (e: PointerEvent<HTMLDivElement>): number =>
    orientation === 'horizontal' ? e.clientY : e.clientX

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const map = startDrag(posOf(e))
    if (map === null) return
    mapRef.current = map
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
    const map = mapRef.current
    if (!dragging || map === null) return
    const next = map(posOf(e))
    lastRef.current = next
    onDrag(next)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* capture was never taken (see the start of the drag); nothing to release */
    }
    const last = lastRef.current
    mapRef.current = null
    lastRef.current = null
    if (last !== null) onCommit(last)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const keys: Partial<Record<string, -1 | 1>> = KEYS[orientation]
    const direction = keys[e.key]
    if (direction === undefined) return
    e.preventDefault()
    onCommit(stepValue(direction))
  }

  return (
    <div
      className={styles.divider}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      data-orientation={orientation}
      data-testid={testId}
      {...(dragging ? { 'data-dragging': true } : {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(resetValue)}
    />
  )
}
