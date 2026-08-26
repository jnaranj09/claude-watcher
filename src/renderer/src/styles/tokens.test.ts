// Story 1.3 — the 1:1 / no-drift guarantee (AC-1).
//
// Parses the GENERATED `tokens.css` `:root` block and asserts every custom property
// matches the typed `TOKENS` map character-for-character — in BOTH directions
// (no token missing from the sheet, no token in the sheet that isn't in the map).
// A typo on either side fails LOUDLY. This is the "one source of truth" guard.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'

/** Parse `--name: value;` declarations out of the single `:root { ... }` block. */
function parseRootCustomProps(css: string): Record<string, string> {
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/)
  if (!rootMatch || rootMatch[1] === undefined) {
    throw new Error('tokens.css has no :root { ... } block')
  }
  const body = rootMatch[1]
  const out: Record<string, string> = {}
  // Match `--name: value;`, stripping any trailing /* ... */ comment on the line.
  const declRe = /--([\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(body)) !== null) {
    const name = m[1]
    const rawValue = m[2]
    if (name === undefined || rawValue === undefined) continue
    const value = rawValue.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    out[name] = value
  }
  return out
}

/**
 * Normalize for comparison: CSS allows whitespace after commas in rgba()/font
 * stacks where the TS string omits it. We compare with all spaces removed so
 * `rgba(10,10,8,0.62)` (TS) === `rgba(10, 10, 8, 0.62)` (CSS) — the VALUES are
 * identical, only formatting differs.
 */
function canon(v: string): string {
  return v.replace(/\s+/g, '')
}

// `__dirname` is provided by Vitest's module wrapper (Node CJS-style interop) and
// resolves to this test file's directory on disk regardless of the jsdom transform.
const css = readFileSync(resolve(dirname(__filename), 'tokens.css'), 'utf8')
const cssProps = parseRootCustomProps(css)

describe('design tokens — tokens.css is 1:1 with the TOKENS source of truth (AC-1)', () => {
  it('every TOKENS entry is present in tokens.css with the same value', () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(cssProps, `tokens.css is missing --${name}`).toHaveProperty(name)
      expect(canon(cssProps[name] ?? ''), `--${name} value drift`).toBe(canon(value))
    }
  })

  it('tokens.css declares no custom property that is absent from TOKENS', () => {
    const tokenNames = new Set(Object.keys(TOKENS))
    const extras = Object.keys(cssProps).filter((n) => !tokenNames.has(n))
    expect(extras, `tokens.css has untracked custom properties: ${extras.join(', ')}`).toEqual([])
  })

  // The rail's selection scheme is INVERTED: the row you are viewing paints the TERMINAL surface
  // and every resting row is raised above it. That direction is the whole point, and it is
  // invisible to a name-only check — swapping the two hex values would leave every other test green
  // while flipping the rail back. Pin it on the values.
  it('the terminal surface is darker than a RESTING rail row (the inverted fill scheme)', () => {
    const lum = (hex: string): number => {
      const n = parseInt(hex.replace('#', ''), 16)
      // Rec. 601 luma is enough here — both tokens are the same warm neutral, so we are ordering
      // two greys, not comparing hues.
      return 0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)
    }
    expect(lum(TOKENS['bg-terminal'])).toBeLessThan(lum(TOKENS['bg-row-rest']))
  })

  // The active rail row paints `--bg-terminal` DIRECTLY (see AttentionRail.module.css `.active`)
  // precisely so no second token can hold a stale copy of that value. Re-adding one would let the
  // rail and the terminal drift apart silently, which is the one thing that treatment cannot
  // survive — the row's whole claim is that it IS the terminal's surface.
  it('defines no rail-active colour token that could drift from --bg-terminal', () => {
    expect(TOKENS).not.toHaveProperty('bg-row-active')
    expect(cssProps).not.toHaveProperty('bg-row-active')
  })

  it('keeps the harmless `done` token defined (1:1) even though no component uses it', () => {
    expect(TOKENS.done).toBe('#a6e3a1')
    expect(cssProps).toHaveProperty('done')
  })
})
