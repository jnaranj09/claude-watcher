// Story 1.3 — the pure sort primitive (AC-6, UX-DR10).
//
// Orders cards within a column by TIME-ENTERED-COLUMN:
//   - `working`             → MOST-RECENT first (descending enteredAt)
//   - `needs-you` / `idle`  → LONGEST-WAITING first (ascending enteredAt)
//
// PURE + side-effect-free: it takes the entered-column timestamp (epoch-millis) via
// a `getEnteredAt` accessor — it does NOT call `now()`, does NOT read live state,
// does NOT subscribe to a store, and does NOT mutate its input. STABLE: items with
// equal timestamps keep their original relative order.
//
// NOTE: the real `enteredColumnAt` is stamped in MAIN (Story 1.2's tracker) but is
// NOT yet on the IPC wire — wiring it to the renderer + feeding it here is Story
// 1.4's job. This util just consumes a timestamp accessor. [Dev Notes: "Sort key
// not yet on the wire"; src/main/c9watch/columns.ts `Column`]

/** The three live columns — mirrors the main-side `Column` union. */
export type SortColumn = 'working' | 'needs-you' | 'idle'

/**
 * Return a NEW array of `items` ordered by entered-column time for `column`.
 * `working` is descending (newest on top); `needs-you`/`idle` are ascending
 * (longest-waiting on top). Stable for ties. The input array is never mutated.
 */
export function sortByEnteredColumn<T>(
  items: readonly T[],
  getEnteredAt: (item: T) => number,
  column: SortColumn
): T[] {
  // Descending only for `working`; ascending for needs-you / idle.
  const descending = column === 'working'

  // Decorate-sort-undecorate to guarantee STABILITY independent of the engine's
  // Array.prototype.sort stability (and to call the accessor exactly once per item).
  return items
    .map((item, index) => ({ item, index, key: getEnteredAt(item) }))
    .sort((a, b) => {
      const cmp = descending ? b.key - a.key : a.key - b.key
      // Equal keys → preserve original order (stable).
      return cmp !== 0 ? cmp : a.index - b.index
    })
    .map((d) => d.item)
}
