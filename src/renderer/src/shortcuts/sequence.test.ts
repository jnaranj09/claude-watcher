// Phrase shortcuts — the 1..3 chord state machine. Pure: no React, no DOM, no timers, so every
// transition in the design's diagram gets a row here. Gate: `unit` project.
import { describe, it, expect } from 'vitest'
import {
  buildSequenceIndex,
  reduceKeyDown,
  reduceTimeout,
  SEQUENCE_TIMEOUT_MS,
  type SequenceIndex
} from './sequence'
import type { ChordEventLike } from './chord'

const O = 'Ctrl+Alt+O'
const A = 'Ctrl+Alt+A'
const B = 'Ctrl+Alt+B'
const Z = 'Ctrl+Alt+Z'

/** Bindings: O alone, O+A, B alone, and a 3-chord O+A+Z. */
function index(): SequenceIndex {
  return buildSequenceIndex([
    { keys: [O], text: 'phrase-O' },
    { keys: [O, A], text: 'phrase-OA' },
    { keys: [O, A, Z], text: 'phrase-OAZ' },
    { keys: [B], text: 'phrase-B' }
  ])
}

function chord(letter: string): ChordEventLike {
  return {
    type: 'keydown',
    key: letter,
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    getModifierState: () => false
  }
}

function plain(key: string): ChordEventLike {
  return {
    type: 'keydown',
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    getModifierState: () => false
  }
}

describe('SEQUENCE_TIMEOUT_MS', () => {
  it('is 750ms — long enough for a deliberate second chord, short of the 1s "broken" threshold', () => {
    expect(SEQUENCE_TIMEOUT_MS).toBe(750)
  })
})

describe('reduceKeyDown', () => {
  it('passes an ordinary key through untouched while idle', () => {
    expect(reduceKeyDown([], plain('x'), index())).toEqual({
      emit: [],
      pending: [],
      swallow: false
    })
  })

  // Design §5 hazard 3: an UNMATCHED Ctrl+Alt chord must reach the pty unchanged, so xterm can
  // emit its ESC + control byte. Swallowing it would silently steal the namespace from claude.
  it('passes an UNBOUND Ctrl+Alt chord through untouched', () => {
    expect(reduceKeyDown([], chord('q'), index())).toEqual({
      emit: [],
      pending: [],
      swallow: false
    })
  })

  it('fires an unambiguous binding immediately and swallows the key', () => {
    expect(reduceKeyDown([], chord('b'), index())).toEqual({
      emit: ['phrase-B'],
      pending: [],
      swallow: true
    })
  })

  // The operator's example: O is bound AND is a prefix, so it must WAIT rather than fire.
  it('pends a bound chord that is also a prefix', () => {
    expect(reduceKeyDown([], chord('o'), index())).toEqual({
      emit: [],
      pending: [O],
      swallow: true
    })
  })

  it('pends again at depth 2 when a 3-chord binding is still possible', () => {
    expect(reduceKeyDown([O], chord('a'), index())).toEqual({
      emit: [],
      pending: [O, A],
      swallow: true
    })
  })

  it('fires the 3-chord binding at depth 3 (depth 3 can never pend)', () => {
    expect(reduceKeyDown([O, A], chord('z'), index())).toEqual({
      emit: ['phrase-OAZ'],
      pending: [],
      swallow: true
    })
  })

  it('resolves the pending prefix and RE-EVALUATES a dead-end chord that is itself bound', () => {
    expect(reduceKeyDown([O], chord('b'), index())).toEqual({
      emit: ['phrase-O', 'phrase-B'],
      pending: [],
      swallow: true
    })
  })

  it('resolves the pending prefix and passes an UNBOUND dead-end chord through', () => {
    expect(reduceKeyDown([O], chord('q'), index())).toEqual({
      emit: ['phrase-O'],
      pending: [],
      swallow: false
    })
  })

  it('emits nothing when the pending prefix is not itself bound', () => {
    const onlyLong = buildSequenceIndex([{ keys: [O, A], text: 'phrase-OA' }])
    expect(reduceKeyDown([O], chord('q'), onlyLong)).toEqual({
      emit: [],
      pending: [],
      swallow: false
    })
  })

  it('resolves the pending prefix on any non-chord key and lets the key through', () => {
    expect(reduceKeyDown([O], plain('x'), index())).toEqual({
      emit: ['phrase-O'],
      pending: [],
      swallow: false
    })
  })

  // Escape is this app's interrupt signal. Typing a phrase on the way to an interrupt is exactly
  // the wrong outcome, so it CANCELS instead of resolving.
  it('cancels without firing on Escape, and lets the Escape through', () => {
    expect(reduceKeyDown([O], plain('Escape'), index())).toEqual({
      emit: [],
      pending: [],
      swallow: false
    })
  })

  it('does not clear a pending sequence on a keyup', () => {
    expect(reduceKeyDown([O], { ...plain('x'), type: 'keyup' }, index())).toEqual({
      emit: [],
      pending: [O],
      swallow: false
    })
  })

  // A dead-end chord that is itself a PREFIX restarts the machine PENDING, not firing. Here the
  // abandoned prefix [B] is unbound on its own (only B+Z is bound), so nothing is emitted.
  it('resolves the prefix and PENDS again when the dead-end chord starts its own sequence', () => {
    const twoTrees = buildSequenceIndex([
      { keys: [B, Z], text: 'phrase-BZ' },
      { keys: [O], text: 'phrase-O' },
      { keys: [O, A], text: 'phrase-OA' }
    ])
    expect(reduceKeyDown([B], chord('o'), twoTrees)).toEqual({
      emit: [],
      pending: [O],
      swallow: true
    })
  })

  // Same transition, but the abandoned prefix IS bound: its phrase fires before the new chord
  // pends. At most two phrases are ever emitted, in order.
  it('emits the abandoned prefix phrase before pending the new chord', () => {
    const twoTrees = buildSequenceIndex([
      { keys: [B], text: 'phrase-B' },
      { keys: [B, Z], text: 'phrase-BZ' },
      { keys: [O], text: 'phrase-O' },
      { keys: [O, A], text: 'phrase-OA' }
    ])
    expect(reduceKeyDown([B], chord('o'), twoTrees)).toEqual({
      emit: ['phrase-B'],
      pending: [O],
      swallow: true
    })
  })
})

describe('reduceTimeout', () => {
  it('fires a bound prefix', () => {
    expect(reduceTimeout([O], index())).toEqual({ emit: ['phrase-O'], pending: [], swallow: false })
  })

  it('fires nothing for a prefix that is not itself bound', () => {
    const onlyLong = buildSequenceIndex([{ keys: [O, A], text: 'phrase-OA' }])
    expect(reduceTimeout([O], onlyLong)).toEqual({ emit: [], pending: [], swallow: false })
  })

  it('is a no-op when nothing is pending', () => {
    expect(reduceTimeout([], index())).toEqual({ emit: [], pending: [], swallow: false })
  })
})

describe('buildSequenceIndex', () => {
  it('indexes every proper prefix and no full sequence', () => {
    const i = buildSequenceIndex([{ keys: [O, A, Z], text: 't' }])
    expect([...i.prefixes]).toEqual([O, `${O} ${A}`])
    expect([...i.byId.keys()]).toEqual([`${O} ${A} ${Z}`])
  })

  it('indexes a 1-chord binding with no prefixes at all', () => {
    const i = buildSequenceIndex([{ keys: [B], text: 'phrase-B' }])
    expect([...i.prefixes]).toEqual([])
    expect(i.byId.get(B)).toBe('phrase-B')
  })
})
