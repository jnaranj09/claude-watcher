// The end fade of a scroll box (design.md rule 8: a scroll region shows where it ends). Sets
// `data-overflow-end` on the element while content sits below its visible end; the sheet fades the
// box's bottom edge on that attribute. IMPERATIVE on purpose: it is DOM state React never renders,
// so a scroll never re-renders the list. Re-checks on scroll, on a size change, and when rows are
// added or removed (an async load or a search changes the content without a scroll event).
import { useLayoutEffect, type RefObject } from 'react'

export function useOverflowEnd(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const update = (): void => {
      // 1px slack: a fractional zoom leaves scrollTop a sub-pixel short of the end.
      el.toggleAttribute('data-overflow-end', el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(el)
    const rows = new MutationObserver(update)
    rows.observe(el, { childList: true })
    return () => {
      el.removeEventListener('scroll', update)
      resize?.disconnect()
      rows.disconnect()
    }
  }, [ref])
}
