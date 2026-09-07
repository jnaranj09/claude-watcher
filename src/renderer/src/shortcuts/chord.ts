// Phrase shortcuts — the ONE definition of "what is a shortcut chord". Shared by the terminal
// matcher (EmbeddedTerminal) and the dialog's recorder (KeyChordRecorder) so the two can never
// disagree about a keystroke. PURE: no React, no store, no window, no DOM API.

/**
 * The structural subset of `KeyboardEvent` the chord engine reads.
 *
 * Structural on purpose: xterm hands the matcher a real DOM `KeyboardEvent`, React hands the
 * recorder `e.nativeEvent`, and the unit tests build plain objects. All three satisfy this.
 */
export interface ChordEventLike {
  type: string
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  isComposing: boolean
  getModifierState?: (key: string) => boolean
}

/**
 * The canonical chord for a keydown (`Ctrl+Alt+<A-Z>`), or null when the combination is not one.
 *
 * `event.key`, NEVER `event.code`: `code` is physical-position based (on AZERTY it reports `KeyQ`
 * for the key that prints "A"), so recording and matching would disagree per layout.
 *
 * The AltGr guard is three independent layers (design §5 hazard 2):
 *   1. `getModifierState('AltGraph')` — the standard discriminator, and the same signal xterm's
 *      own `_isThirdLevelShift` uses. Called defensively (`typeof === 'function'`): this runs
 *      inside xterm's keydown path and a missing method must never throw.
 *   2. the exact modifier set — on Linux AltGr is XKB ISO_Level3_Shift/Mod5, which Chromium maps
 *      to its AltGr flag and NOT to `altKey`, so `ctrlKey && altKey` already rejects it there.
 *   3. the /^[A-Z]$/ shape test — under AltGr `key` is the COMPOSED character ('@', '€', 'á',
 *      'Dead'), which is not an ASCII letter.
 * Layer 3 holds regardless of platform, which is why the guard survives even if a platform
 * reports the modifier flags differently than expected.
 *
 * `Ctrl+Alt+Shift+<letter>` is deliberately NOT a chord: the modifier set is exact, and leaving
 * that namespace free costs nothing.
 */
export function chordFromEvent(event: ChordEventLike): string | null {
  if (event.type !== 'keydown') return null
  if (event.isComposing) return null
  if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) {
    return null
  }
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return null
  const letter = event.key.toUpperCase()
  if (!/^[A-Z]$/.test(letter)) return null
  return `Ctrl+Alt+${letter}`
}
