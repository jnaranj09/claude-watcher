// The line diff behind Context's History (spec 2026-10-18 §3): built in-house, Myers O(ND).
import { describe, it, expect } from 'vitest'
import { lineDiff } from './myersDiff'

describe('lineDiff', () => {
  it('marks every line same for equal texts', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'same', text: 'b' }
    ])
  })

  it('shows one changed line as a del then an add between same lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'same', text: 'c' }
    ])
  })

  it('shows every line as added from an empty text', () => {
    expect(lineDiff('', 'a\nb')).toEqual([
      { op: 'add', text: 'a' },
      { op: 'add', text: 'b' }
    ])
  })

  it('shows a trailing newline difference as one line change', () => {
    expect(lineDiff('a\nb', 'a\nb\n')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'same', text: 'b' },
      { op: 'add', text: '' }
    ])
  })

  it('handles a removal at the start and an insertion at the end', () => {
    expect(lineDiff('x\na\nb', 'a\nb\ny')).toEqual([
      { op: 'del', text: 'x' },
      { op: 'same', text: 'a' },
      { op: 'same', text: 'b' },
      { op: 'add', text: 'y' }
    ])
  })

  it('diffs a 2000-line file with one changed line quickly', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `line ${i}`)
    const after = [...before]
    after[1000] = 'changed'
    const started = performance.now()
    const out = lineDiff(before.join('\n'), after.join('\n'))
    expect(performance.now() - started).toBeLessThan(200)
    expect(out.filter((l) => l.op !== 'same')).toEqual([
      { op: 'del', text: 'line 1000' },
      { op: 'add', text: 'changed' }
    ])
  })
})
