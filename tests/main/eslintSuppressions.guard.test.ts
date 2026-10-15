// The test-lint budget (spec 2026-10-15 testing standards). `eslint-suppressions.json` holds the
// test-rule violations that existed when the rules landed. ESLint fails on a new violation and on
// a suppression that no longer matches (`--prune-suppressions` removes it). Nothing in ESLint
// stops a re-run of `--suppress-all` from hiding new ones, so this guard pins the total, matched
// EXACTLY: it can only fall, and a fix lowers PINNED_TOTAL in the same commit.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FILE = resolve(__dirname, '../../eslint-suppressions.json')

/** Measured when the test rules landed. Only ever lowered. */
const PINNED_TOTAL = 1365

/** Sum of every `count` in an ESLint bulk-suppressions file; throws on any other shape. */
export function suppressionTotal(json: unknown): number {
  if (typeof json !== 'object' || json === null) throw new Error('suppressions: not an object')
  let total = 0
  for (const rules of Object.values(json)) {
    if (typeof rules !== 'object' || rules === null) throw new Error('suppressions: bad file entry')
    for (const entry of Object.values(rules)) {
      const count: unknown =
        typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'count') : undefined
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1)
        throw new Error('suppressions: bad count')
      total += count
    }
  }
  return total
}

describe('suppressionTotal', () => {
  it('sums every count', () => {
    expect(
      suppressionTotal({
        'a.test.ts': { 'vitest/x': { count: 2 }, 'vitest/y': { count: 1 } },
        'b.test.ts': { 'vitest/x': { count: 4 } }
      })
    ).toBe(7)
  })
  it('throws on a shape it does not know', () => {
    expect(() => suppressionTotal({ 'a.test.ts': { 'vitest/x': { n: 2 } } })).toThrow(/bad count/)
  })
})

describe('eslint-suppressions.json budget', () => {
  it('total equals PINNED_TOTAL (it may only fall; lower the pin with the fix)', () => {
    expect(suppressionTotal(JSON.parse(readFileSync(FILE, 'utf8')))).toBe(PINNED_TOTAL)
  })
})
