// Favorites — the ONE order rule for every list that shows templates or shortcuts (spec
// 2026-10-13-favorites): pinned rows first, each part in the order it came in. Stable, so the
// caller's own order (main's A-Z / alias, own-workspace-first, the expander's match bands) holds
// inside each part.
export function favoritesFirst<T extends { favorite: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => r.favorite), ...rows.filter((r) => !r.favorite)]
}
