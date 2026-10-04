// Focused-view keys (R1, R27, R10 — decision b): claude KEEPS every key while its terminal has
// focus. App's window-level chords (Esc, Ctrl+N, Ctrl+Q) act only on a key that did NOT come from
// inside a terminal, and the focused bar shows "Esc to return" only while that is true.
//
// "Inside a terminal" = inside xterm's own root element (`.xterm`, which xterm creates in
// `term.open()`). Not the whole frame: the dead pane's buttons and the shortcut box sit in the
// frame too, and they are app controls, not the terminal.

/** True when `target` is xterm itself (its helper textarea or anything under its root). */
export function isInsideTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.xterm') !== null
}

/** True when focus sits in an open dialog, so a terminal must not take it. A dialog playing its
 *  exit (`data-leaving`, overlay motion) is already closed: Chromium moves focus off its now-inert
 *  button only some ms later, and that must not keep the terminal from taking focus. */
export function dialogHoldsFocus(active: Element | null): boolean {
  return (
    active !== null &&
    active.closest(
      '[role="dialog"]:not([data-leaving]),[role="alertdialog"]:not([data-leaving])'
    ) !== null
  )
}
