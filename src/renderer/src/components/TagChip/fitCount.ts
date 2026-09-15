// Tags — how many LEADING chips of a one-line chip row fit, leaving room for the `+N` chip when
// some do not (spec T-26). Reads real layout: `offsetWidth` of every chip and of the `+N` probe,
// and the row's `clientWidth`. jsdom has no layout (every width is 0 ⇒ everything "fits"), so the
// real behaviour is checked with a tests/drive screenshot; this function is unit-tested with
// stubbed widths.
export function fitCount(row: HTMLElement): number {
  const chips = [...row.querySelectorAll<HTMLElement>('[data-testid="tag-chip"]')]
  const probe = row.querySelector<HTMLElement>('[data-testid="tag-chip-more"]')
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0
  const available = row.clientWidth
  const widths = chips.map((chip) => chip.offsetWidth)
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0)
  if (total <= available) return chips.length
  const reserve = (probe?.offsetWidth ?? 0) + gap
  let used = 0
  let count = 0
  for (const w of widths) {
    const next = used + (count > 0 ? gap : 0) + w
    if (next + reserve > available) break
    used = next
    count += 1
  }
  return count
}
