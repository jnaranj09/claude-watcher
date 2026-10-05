// Interrupt key — the pure "did the operator just press Escape or Ctrl+C?" detector.
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
//
// CTRL+C (ST-4, probed on claude 2.1.289). A single Ctrl+C early in a turn cancels it like Esc:
// no hook, no transcript marker. At an idle prompt Ctrl+C is not an interrupt (the input box and
// the double-press exit use it), so it counts ONLY while the card is `Working`. In a permission
// prompt, a question or an elicitation (needs-you) it changes nothing: its effect there was not
// probed, and keeping the alert is the safe side. Mid-tool claude also writes `[Request
// interrupted by user for tool use]`; that marker lands on the same idle status, exactly like Esc.

/** The byte xterm sends for a bare Escape keypress. */
const ESC = '\x1b'
/** The byte xterm sends for Ctrl+C. */
const CTRL_C = '\x03'

/**
 * True when this chunk of terminal input is exactly one Escape or one Ctrl+C keypress — a key
 * that may tell claude to stop. `interruptDemotes` decides whether it does, given the card.
 */
export function isInterruptKey(data: string): boolean {
  return data === ESC || data === CTRL_C
}

/** The key's name for the log line — never the typed bytes themselves. */
export function interruptKeyName(data: string): 'esc' | 'ctrl_c' {
  return data === CTRL_C ? 'ctrl_c' : 'esc'
}

/**
 * True when this key, pressed on a card in `status`, means claude stopped and sits at its prompt.
 * Esc: any card not already idle. Ctrl+C: only a `Working` card (ST-4).
 */
export function interruptDemotes(status: string | undefined, data: string): boolean {
  if (data === ESC) return status !== 'WaitingForInput'
  return data === CTRL_C && status === 'Working'
}

/**
 * The key seam (`watchFeed.interruptLaunched`): call `demote` only when this key interrupts a card
 * in `status`. One function so the wiring is tested, like `applyApprovalKey`.
 */
export function applyInterruptKey(
  status: string | undefined,
  data: string,
  demote: () => void
): void {
  if (interruptDemotes(status, data)) demote()
}
