// The line diff behind Context's History (spec 2026-10-18 §3): Myers' O(ND) algorithm, built
// in-house instead of a dependency (technical-taste §5 "few dependencies"). Pure. An empty text
// has no lines; a trailing newline is one more (empty) line, so it shows as one line change.

import type { DiffLine } from '../../shared/schemas/contextIpc'

/** More edits than this and the diff gives up (null): its memory grows with the edits squared,
 *  and it runs on the main process. Context then says the file is too large to compare. */
export const MAX_DIFF_EDITS = 2000

const lines = (text: string): string[] => (text === '' ? [] : text.split('\n'))

/** The diff, or null when the two texts differ by more than MAX_DIFF_EDITS lines. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = lines(before)
  const b = lines(after)
  const n = a.length
  const m = b.length
  // trace[d][k + d] = the furthest x on diagonal k after d edits (only k in -d..d is kept).
  const trace: Int32Array[] = []
  const at = (d: number, k: number): number => (d < 0 ? 0 : (trace[d]?.[k + d] ?? 0))
  let done = n === 0 && m === 0
  for (let d = 0; !done; d++) {
    if (d > MAX_DIFF_EDITS) return null
    const row = new Int32Array(2 * d + 1)
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1))
      let x = d === 0 ? 0 : down ? at(d - 1, k + 1) : at(d - 1, k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      row[k + d] = x
      if (x >= n && y >= m) done = true
    }
    trace.push(row)
  }
  // Walk back from (n, m) through the saved rows, collecting moves in reverse.
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const k = x - y
    const down = k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(d - 1, prevK)
    const prevY = prevX - prevK
    const startX = down ? prevX : prevX + 1
    const startY = startX - k
    while (x > startX && y > startY) {
      out.push({ op: 'same', text: a[x - 1] ?? '' })
      x--
      y--
    }
    if (down) out.push({ op: 'add', text: b[prevY] ?? '' })
    else out.push({ op: 'del', text: a[prevX] ?? '' })
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    out.push({ op: 'same', text: a[x - 1] ?? '' })
    x--
    y--
  }
  return out.reverse()
}
