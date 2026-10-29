// The end fade of a scroll box (design.md rule 8: a scroll region shows where it ends). Sets
// `data-overflow-end` on the element while content sits below its visible end; the sheet fades the
// box's bottom edge on that attribute. IMPERATIVE on purpose: it is DOM state React never renders,
// so a scroll never re-renders the list. Re-checks on scroll, on a size change, and when content is
// added or removed anywhere inside (an async load, a search, a task added deep in a form body all
// change the content without a scroll event). Used by the rail's rows and a form's or pane's body.
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
    const content = new MutationObserver(update)
    content.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('scroll', update)
      resize?.disconnect()
      content.disconnect()
    }
  }, [ref])
}
