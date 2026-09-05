// Phrase shortcuts — the 1..3 chord SEQUENCE state machine.
//
// PURE: no React, no DOM, no timers, no store. The caller (EmbeddedTerminal) owns the pending
// ref, the timeout timer and the port; this module only answers "given the pending prefix and
// this key, what happens?". That split is what makes every transition testable without jsdom.
//
// The model is vim's `timeoutlen`: a bound PREFIX pends and resolves to its own phrase on the
// timeout, or on any key that does not continue it. That is the only model in which
// `Ctrl+Alt+O` and `Ctrl+Alt+O Ctrl+Alt+A` can BOTH fire, which is the operator's requirement.
import { shortcutKeysId } from '../../../shared/schemas/shortcut'
import { chordFromEvent, type ChordEventLike } from './chord'

/**
 * How long a bound PREFIX waits for its continuation before resolving to its own phrase.
 *
 * 750 ms sits between two bounds. It must clear the gap between two deliberate chords typed with
 * the modifiers held down (150-300 ms fluent, ~400-500 ms considered), and it must stay under the
 * ~1 s at which the lag on a lone prefix reads as "the app is broken" rather than "the app is
 * waiting" — vim's 1000 ms default is widely felt to be sluggish for exactly that reason.
 *
 * Only a chord that IS a proper prefix of another binding ever pays this: an unambiguous shortcut
 * fires instantly, so the latency is opt-in per shortcut and only appears once the operator
 * creates the ambiguity himself. Changing this value is a one-line change plus one test constant.
 */
export const SEQUENCE_TIMEOUT_MS = 750

/** The minimum a binding must look like for the matcher. Structural so tests need no ids. */
export interface SequenceBinding {
  keys: readonly string[]
  text: string
}

/** Built once per shortcut-list change, never per keystroke. */
export interface SequenceIndex {
  /** shortcutKeysId(keys) -> phrase. Exact, FULL-sequence matches only. */
  byId: Map<string, string>
  /** shortcutKeysId of every PROPER prefix of some binding. */
  prefixes: Set<string>
}

/**
 * ONE result shape for every transition — the imperative layer just applies it.
 * Readonly throughout: `IDLE` below is a shared module-level value, so nothing may mutate a
 * returned result.
 */
export interface SequenceResult {
  /** Phrases to post to the pty, in order. 0, 1 or 2 entries. */
  readonly emit: readonly string[]
  /** The new pending prefix; [] = idle. Non-empty ⇒ (re)arm the timeout + show the hint. */
  readonly pending: readonly string[]
  /** true ⇒ preventDefault + stopPropagation + return false to xterm. */
  readonly swallow: boolean
}

/** The hot path (every ordinary keystroke) and the untouched-fall-through case. Shared, never
 *  mutated — hence the readonly fields above. */
const IDLE: SequenceResult = { emit: [], pending: [], swallow: false }

export function buildSequenceIndex(bindings: readonly SequenceBinding[]): SequenceIndex {
  const byId = new Map<string, string>()
  const prefixes = new Set<string>()
  for (const binding of bindings) {
    byId.set(shortcutKeysId(binding.keys), binding.text)
    for (let i = 1; i < binding.keys.length; i++) {
      prefixes.add(shortcutKeysId(binding.keys.slice(0, i)))
    }
  }
  return { byId, prefixes }
}

/** The phrase a pending prefix resolves to when the sequence ends — [] when it is not bound. */
function resolvePending(pending: readonly string[], index: SequenceIndex): string[] {
  if (pending.length === 0) return []
  const text = index.byId.get(shortcutKeysId(pending))
  return text === undefined ? [] : [text]
}

/** The sequence ENDED (timeout, blur, or a key that does not continue it): resolve and clear. */
export function reduceTimeout(pending: readonly string[], index: SequenceIndex): SequenceResult {
  return { emit: resolvePending(pending, index), pending: [], swallow: false }
}

export function reduceKeyDown(
  pending: readonly string[],
  event: ChordEventLike,
  index: SequenceIndex
): SequenceResult {
  // Only keydown drives the machine — a keyup must never clear a pending sequence.
  if (event.type !== 'keydown') return { emit: [], pending, swallow: false }

  const chord = chordFromEvent(event)

  if (chord === null) {
    if (pending.length === 0) return IDLE
    // Escape ABORTS: fire nothing, and still let it reach the pty (it is the app's interrupt
    // signal — typing a phrase on the way to an interrupt is exactly wrong).
    if (event.key === 'Escape') return { emit: [], pending: [], swallow: false }
    // Any other key ends the sequence: the prefix resolves to its own phrase (if bound) and the
    // key itself passes through to the agent untouched (UX-DR21).
    return reduceTimeout(pending, index)
  }

  const next = [...pending, chord]
  const nextId = shortcutKeysId(next)

  // A bound PREFIX pends even when it is ALSO an exact binding — that is the whole point:
  // Ctrl+Alt+O and Ctrl+Alt+O Ctrl+Alt+A coexist, and O alone resolves on the timeout.
  // A depth-3 sequence can never be a prefix, so pending is always 0, 1 or 2 chords long.
  if (index.prefixes.has(nextId)) return { emit: [], pending: next, swallow: true }

  const exact = index.byId.get(nextId)
  if (exact !== undefined) return { emit: [exact], pending: [], swallow: true }

  // Dead end. With nothing pending this is a lone unbound chord: leave it COMPLETELY untouched
  // so xterm emits its ESC + control byte to the pty exactly as it does today. That guarantee is
  // what keeps the Ctrl+Alt namespace cheap for claude (design §5 hazard 3).
  if (pending.length === 0) return IDLE

  // Otherwise the pending prefix resolves, and this chord is RE-EVALUATED from idle — it may be
  // a binding or a prefix in its own right. The re-evaluation starts empty, so it cannot dead-end
  // again: at most two phrases are ever emitted, in order.
  const resolved = resolvePending(pending, index)
  const restart = reduceKeyDown([], event, index)
  return {
    emit: [...resolved, ...restart.emit],
    pending: restart.pending,
    swallow: restart.swallow
  }
}
