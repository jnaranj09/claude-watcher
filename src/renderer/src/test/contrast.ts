// WCAG 2.x contrast, for tests that check a colour pair taken from `tokens.ts`. Colour rules are
// asserted on the token VALUES because a CSS-module import is a proxy in Vitest (design.md).

export type Rgb = [number, number, number]

/** '#rrggbb' → [r, g, b], 0–255. Throws on anything else, so a typo cannot pass as black. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (match === null || match[1] === undefined) throw new Error(`not a #rrggbb colour: ${hex}`)
  const v = parseInt(match[1], 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/** `top` at `alpha` over the opaque `bottom` — what the eye sees (= CSS `color-mix` in srgb). */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const mix = (a: number, b: number): number => Math.round(alpha * a + (1 - alpha) * b)
  return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2])]
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
