// The CSS raw-value budget (design.md "UI pipeline" stage 4, `stylelint.config.mjs`).
// `stylelint-suppressions.json` holds the raw values that existed when the token rule landed.
// Nothing in stylelint stops a re-run of `--suppress` from hiding new raw values, so this guard
// pins the total, matched EXACTLY: it can only fall, and a fix lowers PINNED_TOTAL in the same
// commit. Same limit as the ESLint pin: a swap (fix one, add one) shows only in the file's diff.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const FILE = resolve(__dirname, '../../stylelint-suppressions.json')

/** Measured when the rule landed (2026-11-23). Only ever lowered. */
const PINNED_TOTAL = 179

const SuppressionsSchema = z.record(
  z.string(),
  z.record(z.string(), z.object({ count: z.number().int().positive() }))
)

/** Sum of every `count` in a stylelint suppressions file; throws on any other shape. */
export function stylelintSuppressed(json: unknown): number {
  return Object.values(SuppressionsSchema.parse(json))
    .flatMap((rules) => Object.values(rules))
    .reduce((sum, entry) => sum + entry.count, 0)
}

describe('stylelintSuppressed', () => {
  it('sums every count across files and rules', () => {
    expect(
      stylelintSuppressed({
        'a.module.css': { 'rule/x': { count: 2 }, 'rule/y': { count: 1 } },
        'b.module.css': { 'rule/x': { count: 4 } }
      })
    ).toBe(7)
  })
  it('throws on a count that is not a positive integer', () => {
    expect(() => stylelintSuppressed({ 'a.module.css': { 'rule/x': { count: 0 } } })).toThrow()
  })
})

describe('stylelint-suppressions.json budget', () => {
  it('total equals PINNED_TOTAL (it may only fall; lower the pin with the fix)', () => {
    expect(stylelintSuppressed(JSON.parse(readFileSync(FILE, 'utf8')))).toBe(PINNED_TOTAL)
  })
})
