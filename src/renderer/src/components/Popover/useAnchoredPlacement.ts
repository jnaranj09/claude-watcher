// Where a portaled popover sits: under its trigger, or over it when there is no room below, and
// never taller than the room it got. Lined up with the trigger edge the caller asks for, or the
// other edge when the asked one would push it out of the window. A popover drawn INSIDE its caller is cut by the first
// ancestor that clips (the Settings pane scrolls, the dead terminal frame is `overflow: clip`) and
// by the window edge (the empty board's `+ New session` sits low). So the caller portals its
// wrapper to document.body, gives it `position: fixed`, and spreads the style returned here.
//
// The wrapper must be a flex column bounding its Surface, and the Surface its List, so the
// wrapper's `maxHeight` reaches the List and the List scrolls (NewSessionMenu.module.css
// `.portalAnchor`, Select.module.css `.listWrap`). The List keeps its own cap
// (`--popover-max-height`); the room left in the window caps it further.
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Gap between trigger and popover, and the margin kept off the window edge. */
const GAP = 4
const MARGIN = 16

export type PopoverAlign = 'start' | 'end' | 'center'

/** Before the first measure: laid out (so it can be measured) but not seen. */
const UNMEASURED: CSSProperties = { top: 0, left: 0, visibility: 'hidden' }

/** The popover's height with its List unclipped by the window (still under its own cap). */
function naturalHeight(popup: HTMLElement): number {
  const total = popup.getBoundingClientRect().height
  const list = popup.querySelector<HTMLElement>('[data-popover-list]')
  if (list === null) return total
  const cap = parseFloat(getComputedStyle(list).maxHeight)
  const listNatural = Number.isNaN(cap) ? list.scrollHeight : Math.min(list.scrollHeight, cap)
  return total - list.clientHeight + listNatural
}

/** The trigger edge the popover lines up with: the asked one, unless the popover would then pass
 *  the window's far edge and the other edge keeps it inside (the rail's `+ tag` sits near the
 *  left edge, so its right-aligned list ran off the window). */
function sideFor(align: 'start' | 'end', rect: DOMRect, width: number): 'start' | 'end' {
  const fitsEnd = rect.right - width >= 0
  const fitsStart = rect.left + width <= window.innerWidth
  if (align === 'end') return !fitsEnd && fitsStart ? 'start' : 'end'
  return !fitsStart && fitsEnd ? 'end' : 'start'
}

export function useAnchoredPlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  align: PopoverAlign
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(UNMEASURED)

  // Before paint, so the popover never shows at the wrong spot. Re-measured on resize and on any
  // scroll (capture: the Settings pane scrolls, not the window), so it stays on its trigger.
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const trigger = triggerRef.current
      const popup = popupRef.current
      if (trigger === null || popup === null) return
      const rect = trigger.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - GAP - MARGIN
      const above = rect.top - GAP - MARGIN
      const down = naturalHeight(popup) <= below || below >= above
      const vertical: CSSProperties = down
        ? { top: rect.bottom + GAP, maxHeight: Math.max(0, below) }
        : { bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.max(0, above) }
      const horizontal: CSSProperties =
        align === 'center'
          ? { left: rect.left + rect.width / 2, transform: 'translateX(-50%)' }
          : sideFor(align, rect, popup.getBoundingClientRect().width) === 'end'
            ? { right: window.innerWidth - rect.right }
            : { left: rect.left }
      setStyle({ ...vertical, ...horizontal, minWidth: rect.width })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, triggerRef, popupRef, align])

  return style
}
