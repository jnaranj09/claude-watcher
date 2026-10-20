// The line diff behind Context's History (spec 2026-10-18 §3): Myers' O(ND) algorithm, built
// in-house instead of a dependency (technical-taste §5 "few dependencies"). Pure. An empty text
// has no lines; a trailing newline is one more (empty) line, so it shows as one line change.

import type { DiffLine } from '../../shared/schemas/contextIpc'

const lines = (text: string): string[] => (text === '' ? [] : text.split('\n'))

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = lines(before)
  const b = lines(after)
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max + 1
  // v[k + offset] = the furthest x on diagonal k; one copy per step d for the walk back.
  const v = new Array<number>(2 * max + 3).fill(0)
  const trace: number[][] = []
  let found = n === 0 && m === 0
  for (let d = 0; d <= max && !found; d++) {
    trace.push([...v])
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && at(v, k - 1 + offset) < at(v, k + 1 + offset))
      let x = down ? at(v, k + 1 + offset) : at(v, k - 1 + offset) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + offset] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  // Walk back from (n, m) through the saved rows, collecting moves in reverse.
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const row = trace[d] ?? []
    const k = x - y
    const down = k === -d || (k !== d && at(row, k - 1 + offset) < at(row, k + 1 + offset))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(row, prevK + offset)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push({ op: 'same', text: a[x - 1] ?? '' })
      x--
      y--
    }
    if (d > 0) {
      if (down) out.push({ op: 'add', text: b[y - 1] ?? '' })
      else out.push({ op: 'del', text: a[x - 1] ?? '' })
    }
    x = prevX
    y = prevY
  }
  return out.reverse()
}

const at = (row: readonly number[], i: number): number => row[i] ?? 0
