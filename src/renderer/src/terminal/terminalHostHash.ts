// Story 3.1 (FR-10) — the URL-hash gate for the minimal embedded-terminal host.
//
// Kept in its OWN module (not alongside the component) so the renderer's react-refresh rule
// (only-export-components) stays clean — a component file must export only components. This is
// a pure parser, unit-tested directly. [Source: story 3.1 Task 5; react-refresh/only-export-components]

/** Parse `#terminals` / `#terminals=N` from the URL hash → the count of terminals to mount
 *  (0 = not the terminal host). `#terminals` → 1; `#terminals=N` → N, clamped to [1, 64] so a
 *  typo can't spawn a flood (the NFR-5 manual check stays in the low tens). */
export function parseTerminalHostCount(hash: string): number {
  const m = /^#terminals(?:=(\d+))?$/.exec(hash)
  if (!m) return 0
  if (m[1] === undefined) return 1
  const n = Number.parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1) return 0
  return Math.min(n, 64)
}
