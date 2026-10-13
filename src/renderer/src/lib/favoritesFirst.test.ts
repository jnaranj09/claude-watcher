import { describe, it, expect } from 'vitest'
import { favoritesFirst } from './favoritesFirst'

const r = (id: string, favorite: boolean): { id: string; favorite: boolean } => ({ id, favorite })

describe('favoritesFirst', () => {
  it('puts starred rows first and keeps each part in input order', () => {
    const out = favoritesFirst([r('a', false), r('b', true), r('c', false), r('d', true)])
    expect(out.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('returns a new array and leaves the input alone', () => {
    const input = [r('a', false), r('b', true)]
    expect(favoritesFirst(input)).not.toBe(input)
    expect(input.map((x) => x.id)).toEqual(['a', 'b'])
  })
})
