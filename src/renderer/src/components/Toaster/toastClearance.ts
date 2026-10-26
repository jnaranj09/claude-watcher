// How far from the viewport bottom the toast stack must clear to sit above an open dialog's
// buttons: the highest `[data-toast-clearance]` top (a ManageDialog footer, the name prompt's
// actions), measured up from the bottom. A dialog that is closing keeps its DOM while it fades
// (`[data-leaving]` on an ancestor); it must not hold the stack up, so it is skipped. 0 = none.
export function toastClearance(doc: Document, viewportHeight: number): number {
  let top = Infinity
  for (const el of doc.querySelectorAll<HTMLElement>('[data-toast-clearance]')) {
    if (el.closest('[data-leaving]') !== null) continue
    top = Math.min(top, el.getBoundingClientRect().top)
  }
  return top === Infinity ? 0 : Math.max(0, viewportHeight - top)
}
