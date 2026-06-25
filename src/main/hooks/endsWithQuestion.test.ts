// Hook-status feature — unit tests for the endsWithQuestion detector (L2).
//
// Runs under the `main-unit` Vitest project (node).
// Exhaustive per plan L2 Tests: trailing `?`; `?` + trailing whitespace; wrapped
// `**…?**`, backtick-wrapped …?, `(…?)`, `"…?"`; no `?` → false; `?` mid-message
// (not trailing) → false; empty/undefined → false; multi-line ending in a question.
// [plan-hook-phase2-needs-you.md L2 step 6 + Tests]

import { describe, it, expect } from 'vitest'
import { endsWithQuestion } from './endsWithQuestion'

describe('endsWithQuestion — plain-prose question detector', () => {
  // --- positive: trailing `?` (bare + with trailing whitespace) ---
  it('trailing `?` → true', () => {
    expect(endsWithQuestion('Should I proceed?')).toBe(true)
  })

  it('`?` followed by trailing whitespace → true', () => {
    expect(endsWithQuestion('Should I proceed?   ')).toBe(true)
    expect(endsWithQuestion('Should I proceed?\n')).toBe(true)
    expect(endsWithQuestion('Should I proceed?\n\n  \t')).toBe(true)
  })

  // --- positive: `?` wrapped by trailing wrapper chars ---
  it('markdown-bold wrapped `**…?**` → true', () => {
    expect(endsWithQuestion('**Should I proceed?**')).toBe(true)
  })

  it('backtick-wrapped `…?` → true', () => {
    expect(endsWithQuestion('Run `git push`?`')).toBe(true)
    expect(endsWithQuestion('Is it `done?`')).toBe(true)
  })

  it('parenthesized `(…?)` → true', () => {
    expect(endsWithQuestion('Proceed (or not?)')).toBe(true)
  })

  it('double-quote wrapped `"…?"` → true', () => {
    expect(endsWithQuestion('Did you mean "this?"')).toBe(true)
  })

  it('curly-quote / underscore / bracket wrappers after `?` → true', () => {
    expect(endsWithQuestion('Ready to go?”')).toBe(true)
    expect(endsWithQuestion('Ready to go?’')).toBe(true)
    expect(endsWithQuestion('_Ready to go?_')).toBe(true)
    expect(endsWithQuestion('See item [1?]')).toBe(true)
  })

  it('wrapper + trailing whitespace after `?` → true', () => {
    expect(endsWithQuestion('**Should I proceed?**\n')).toBe(true)
  })

  // --- positive: multi-line ending in a question ---
  it('multi-line message ending in a question → true', () => {
    const msg = 'I finished the refactor and ran the tests.\nThey all pass.\nWant me to push?'
    expect(endsWithQuestion(msg)).toBe(true)
  })

  // --- negative: no `?` anywhere ---
  it('no `?` → false', () => {
    expect(endsWithQuestion('All done.')).toBe(false)
    expect(endsWithQuestion('I pushed the branch and opened the PR.')).toBe(false)
  })

  it('no `?` multi-line → false', () => {
    expect(endsWithQuestion('Done.\nTests pass.\nPushed the branch.')).toBe(false)
  })

  // --- negative: `?` present but mid-message, not trailing ---
  it('`?` mid-message (not trailing, outside tail window) → false', () => {
    expect(
      endsWithQuestion('Should I proceed? I went ahead and did it, then ran the full suite.')
    ).toBe(false)
  })

  it('`?` followed by a long sentence (outside tail window) → false', () => {
    expect(endsWithQuestion('Was it broken? Yes, and I have now fully repaired it.')).toBe(false)
  })

  // --- negative: empty / undefined / whitespace-only ---
  it('undefined → false', () => {
    expect(endsWithQuestion(undefined)).toBe(false)
  })

  it('empty string → false', () => {
    expect(endsWithQuestion('')).toBe(false)
  })

  it('whitespace-only → false', () => {
    expect(endsWithQuestion('   ')).toBe(false)
    expect(endsWithQuestion('\n\n\t  ')).toBe(false)
  })

  // --- belt-and-suspenders tail window (covers `?)` `?"` `?**` without final-char match) ---
  it('`?` within the last ~8 non-whitespace chars (multiple trailing tokens) → true', () => {
    // `?` is not the final char and the closing run is more than one wrapper, but
    // the `?` still sits inside the tail window.
    expect(endsWithQuestion('ok?")')).toBe(true)
  })

  // --- purity: repeated calls are deterministic, no throw ---
  it('is a pure function — repeated calls are deterministic', () => {
    expect(endsWithQuestion('Proceed?')).toBe(true)
    expect(endsWithQuestion('Proceed?')).toBe(true)
    expect(endsWithQuestion('Done.')).toBe(false)
    expect(endsWithQuestion('Done.')).toBe(false)
  })
})
