/** A computed `rgb()`/`rgba()` colour → 0..1 channels; anything else → null. */
export function parseRgb(value: string): [number, number, number] | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(value.trim())
  if (m === null) return null
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255]
}
