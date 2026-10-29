// Where the toast stack sits, in px from the viewport's right and bottom edges, before the Toaster's
// --space-4 gutter is added. With no dialog open: 0/0, the board corner. With one open, the stack
// sits INSIDE the dialog's panel (`[data-toast-anchor]`), in its bottom-right corner, and `room` is
// the panel's width so the stack never pokes out of it. A button row (`[data-toast-clearance]`) in
// the panel that the stack would cover there pushes it up to sit above that row instead. A dialog
// that is closing keeps its DOM while it fades (`[data-leaving]` on an ancestor); it does not hold
// the stack, which goes back to the corner.
export interface ToastPlacement {
  right: number
  bottom: number
  /** The anchor panel's width, or null (no dialog: the viewport is the room). */
  room: number | null
}

export interface ToastStack {
  /** The stack's own height, to tell whether it would cover a button row. */
  height: number
  /** The gutter (px) the Toaster's CSS puts between the stack and the edge it sits against. */
  gap: number
}

const isLeaving = (el: Element): boolean => el.closest('[data-leaving]') !== null

export function toastPlacement(
  doc: Document,
  viewport: { width: number; height: number },
  stack: ToastStack
): ToastPlacement {
  const anchors = [...doc.querySelectorAll<HTMLElement>('[data-toast-anchor]')].filter(
    (el) => !isLeaving(el)
  )
  // The last one in DOM order is the one drawn on top.
  const anchor = anchors.at(-1)
  if (anchor === undefined) return { right: 0, bottom: 0, room: null }
  const panel = anchor.getBoundingClientRect()
  let bottom = viewport.height - panel.bottom
  const stackTop = panel.bottom - stack.gap - stack.height
  for (const row of anchor.querySelectorAll<HTMLElement>('[data-toast-clearance]')) {
    if (isLeaving(row)) continue
    const rect = row.getBoundingClientRect()
    if (rect.bottom > stackTop) bottom = Math.max(bottom, viewport.height - rect.top)
  }
  return {
    right: Math.max(0, viewport.width - panel.right),
    bottom: Math.max(0, bottom),
    room: panel.width
  }
}
