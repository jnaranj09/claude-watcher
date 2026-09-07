// Phrase shortcuts — the chord table. Gate: `unit` (jsdom) project, but nothing here needs a DOM.
import { describe, it, expect } from 'vitest'
import { chordFromEvent, type ChordEventLike } from './chord'

function ev(init: Partial<ChordEventLike> & { key: string }): ChordEventLike {
  return {
    type: 'keydown',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    getModifierState: () => false,
    ...init
  }
}

describe('chordFromEvent', () => {
  it('canonicalizes a lower-case letter', () => {
    expect(chordFromEvent(ev({ key: 'a', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+A')
  })

  it('canonicalizes an upper-case letter', () => {
    expect(chordFromEvent(ev({ key: 'A', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+A')
  })

  it.each([
    ['no modifiers', { key: 'a' }],
    ['plain Ctrl', { key: 'a', ctrlKey: true }],
    ['plain Alt', { key: 'a', altKey: true }],
    ['Ctrl+Shift (the old namespace)', { key: 'A', ctrlKey: true, shiftKey: true }],
    ['Ctrl+Alt+Shift', { key: 'A', ctrlKey: true, altKey: true, shiftKey: true }],
    ['Ctrl+Alt+Meta', { key: 'a', ctrlKey: true, altKey: true, metaKey: true }],
    ['a digit', { key: '1', ctrlKey: true, altKey: true }],
    ['a named key', { key: 'Enter', ctrlKey: true, altKey: true }],
    ['a dead key', { key: 'Dead', ctrlKey: true, altKey: true }],
    ['a keyup', { key: 'a', ctrlKey: true, altKey: true, type: 'keyup' }],
    ['an IME composition', { key: 'a', ctrlKey: true, altKey: true, isComposing: true }]
  ])('returns null for %s', (_label, init) => {
    expect(chordFromEvent(ev(init as Partial<ChordEventLike> & { key: string }))).toBeNull()
  })

  // AltGr guard, layer 1 (design §5 hazard 2). On Windows AltGr is reported as ctrl+alt; on
  // Linux it is Mod5. getModifierState('AltGraph') is the discriminator on both, and it is the
  // same signal xterm's own _isThirdLevelShift uses. Deleting this term must turn this red.
  it('returns null when AltGraph is active even though ctrl+alt are set', () => {
    expect(
      chordFromEvent(ev({ key: 'q', ctrlKey: true, altKey: true, getModifierState: () => true }))
    ).toBeNull()
  })

  // AltGr guard, layer 3: under AltGr the key IS the composed character, which is not A-Z. This
  // layer holds regardless of what the platform reports for the modifier flags.
  it.each([['@'], ['€'], ['¬'], ['á']])('returns null for the AltGr character %s', (key) => {
    expect(chordFromEvent(ev({ key, ctrlKey: true, altKey: true }))).toBeNull()
  })

  // The unit harnesses build event-LIKE plain objects, and this runs inside xterm's keydown
  // path — a missing method must never throw.
  it('does not throw when the event has no getModifierState', () => {
    const bare = { ...ev({ key: 'a', ctrlKey: true, altKey: true }) }
    delete (bare as { getModifierState?: unknown }).getModifierState
    expect(() => chordFromEvent(bare)).not.toThrow()
    expect(chordFromEvent(bare)).toBe('Ctrl+Alt+A')
  })
})
