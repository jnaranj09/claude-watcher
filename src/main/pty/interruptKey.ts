// Interrupt key — the pure "did the operator just press Escape?" detector.
//
// WHY THIS IS THE SIGNAL. Interrupting a claude turn produces nothing observable out of
// band. Probe-verified on claude 2.1.250 (2026-08-27):
//   - NO hook fires, of any kind — 12 events captured before the keypress, 12 after, and
//     no `idle_prompt` notification even after 90 seconds. True for both `command` and
//     `http` hook types.
//   - The TRANSCRIPT records `[Request interrupted by user…]` only when there was
//     assistant content to interrupt. Interrupting early — type "hi", hit Esc — cancels
//     cleanly, restores the prompt to the input box, and writes NOTHING, not even after
//     the next prompt is submitted.
//
// So the keypress is the only evidence there is, and the app already has it: every byte
// the renderer types crosses main on its way to the pty (`terminalManager`), so reading
// it costs nothing and adds no polling, no file watching and no scraping of claude's
// OUTPUT — this is input the app itself is forwarding.
//
// EXACT MATCH, NOT A PREFIX. xterm sends `\x1b` alone for Escape, but arrow keys
// (`\x1b[A`), function keys (`\x1bOP`), Delete (`\x1b[3~`) and bracketed paste
// (`\x1b[200~`) all START with the same byte. A prefix match would read every arrow key
// as an interrupt.
//
// THE KNOWN FALSE POSITIVE. Escape also dismisses claude's autocomplete and `/` menus, so
// closing one demotes the card. That is self-limiting: to have a menu open you must be
// typing in that terminal, so you are looking straight at it — and the board exists for
// the sessions you are NOT looking at. The next tool event puts it back to `Working`.

/** The byte xterm sends for a bare Escape keypress. */
const ESC = '\x1b'

/**
 * True when this chunk of terminal input is exactly one Escape keypress — the operator
 * telling claude to stop.
 */
export function isInterruptKey(data: string): boolean {
  return data === ESC
}
