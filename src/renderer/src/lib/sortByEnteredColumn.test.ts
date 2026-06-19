// Story 1.3 — sortByEnteredColumn tests (AC-6).
//
// Deterministic (FIXED timestamps, no now()). Asserts ordering per column,
// non-mutation of the input, and stable ordering for ties.
import { describe, it, expect } from 'vitest'
import { sortByEnteredColumn } from './sortByEnteredColumn'

interface Card {
  id: string
  enteredAt: number
}

const getEnteredAt = (c: Card): number => c.enteredAt

// Fixed epoch-millis: older → newer.
const OLD = 1_000
const MID = 2_000
const NEW = 3_000

describe('sortByEnteredColumn — pure ordering by time-entered-column (AC-6)', () => {
  it('working → MOST-RECENT first (descending enteredAt)', () => {
    const items: Card[] = [
      { id: 'old', enteredAt: OLD },
      { id: 'new', enteredAt: NEW },
      { id: 'mid', enteredAt: MID }
    ]
    const sorted = sortByEnteredColumn(items, getEnteredAt, 'working')
    expect(sorted.map((c) => c.id)).toEqual(['new', 'mid', 'old'])
  })

  it('needs-you → LONGEST-WAITING first (ascending enteredAt)', () => {
    const items: Card[] = [
      { id: 'new', enteredAt: NEW },
      { id: 'old', enteredAt: OLD },
      { id: 'mid', enteredAt: MID }
    ]
    const sorted = sortByEnteredColumn(items, getEnteredAt, 'needs-you')
    expect(sorted.map((c) => c.id)).toEqual(['old', 'mid', 'new'])
  })

  it('idle → LONGEST-WAITING first (ascending enteredAt)', () => {
    const items: Card[] = [
      { id: 'mid', enteredAt: MID },
      { id: 'new', enteredAt: NEW },
      { id: 'old', enteredAt: OLD }
    ]
    const sorted = sortByEnteredColumn(items, getEnteredAt, 'idle')
    expect(sorted.map((c) => c.id)).toEqual(['old', 'mid', 'new'])
  })

  it('does NOT mutate the input array', () => {
    const items: Card[] = [
      { id: 'a', enteredAt: NEW },
      { id: 'b', enteredAt: OLD }
    ]
    const snapshot = items.map((c) => c.id)
    sortByEnteredColumn(items, getEnteredAt, 'working')
    expect(items.map((c) => c.id)).toEqual(snapshot)
  })

  it('returns a NEW array (referential non-aliasing)', () => {
    const items: Card[] = [{ id: 'a', enteredAt: NEW }]
    const sorted = sortByEnteredColumn(items, getEnteredAt, 'idle')
    expect(sorted).not.toBe(items)
  })

  it('is STABLE for ties (ascending) — equal timestamps keep original order', () => {
    const items: Card[] = [
      { id: 'first', enteredAt: MID },
      { id: 'second', enteredAt: MID },
      { id: 'third', enteredAt: MID }
    ]
    const sorted = sortByEnteredColumn(items, getEnteredAt, 'needs-you')
    expect(sorted.map((c) => c.id)).toEqual(['first', 'second', 'third'])
  })

  it('is STABLE for ties (descending) — equal timestamps keep original order', () => {
    const items: Card[] = [
      { id: 'first', enteredAt: MID },
      { id: 'second', enteredAt: MID },
      { id: 'third', enteredAt: MID }
    ]
    const sorted = sortByEnteredColumn(items, getEnteredAt, 'working')
    expect(sorted.map((c) => c.id)).toEqual(['first', 'second', 'third'])
  })

  it('handles empty and single-item inputs', () => {
    expect(sortByEnteredColumn([], getEnteredAt, 'working')).toEqual([])
    const one: Card[] = [{ id: 'solo', enteredAt: MID }]
    expect(sortByEnteredColumn(one, getEnteredAt, 'idle').map((c) => c.id)).toEqual(['solo'])
  })
})
