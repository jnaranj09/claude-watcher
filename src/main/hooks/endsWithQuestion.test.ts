// Hook-status feature — unit tests for the endsWithQuestion detector (L2).
//
// Runs under the `main-unit` Vitest project (node).
// Exhaustive per plan L2 Tests: trailing `?`; `?` + trailing whitespace; wrapped
// `**…?**`, backtick-wrapped …?, `(…?)`, `"…?"`; no `?` → false; empty/undefined
// → false; multi-line ending in a question; multi-line question tails (last 3
// non-empty lines); fenced code blocks stripped before scanning (task-3
// controller ruling); ask-phrase list over the last 2 non-empty lines.
// [plan-hook-phase2-needs-you.md L2 step 6 + Tests; task-3 brief]

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
  // NOTE (task-3, controller-anticipated Step 4 case): the trailing `?` check
  // (layer 1) still says false here — the `?` is not near the tail. But the new
  // ask-phrase layer (layer 2) scans the LAST 2 non-empty lines as a whole, and
  // this message has only ONE line, so "Should I" (an ask-phrase) sits inside
  // that scanned line regardless of its position within it. Per the brief's
  // Step 4 guidance ("if an old case pinned 'question earlier in the message →
  // false' and now scans differently, judge against the spec"), this is the
  // documented, intended layer-2 behavior — false positives here are cheap
  // (YourTurn → NeedsAttention, both already needs-you) — so the expectation
  // flips to true.
  it('`?` mid-message (not trailing) but contains an ask-phrase → true (layer 2)', () => {
    expect(
      endsWithQuestion('Should I proceed? I went ahead and did it, then ran the full suite.')
    ).toBe(true)
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

describe('multi-line tails (question followed by options)', () => {
  it('detects a ? at the end of one of the last 3 non-empty lines', () => {
    expect(endsWithQuestion('Which option do you prefer?\n- A: keep it\n- B: remove it')).toBe(true)
    expect(endsWithQuestion('Should I continue?\n\n```\nnpm run test\n```')).toBe(true)
  })
  it('does not scan beyond the last 3 non-empty lines', () => {
    expect(endsWithQuestion('Is this ok?\nline\nline\nline\nAll done. Everything passes.')).toBe(
      false
    )
  })
})

describe('fenced code blocks are stripped before line scanning (controller ruling)', () => {
  it('a LONG (5+ line) trailing fenced code block does not hide the question above it', () => {
    const msg = 'Should I proceed?\n```\nline1\nline2\nline3\nline4\nline5\n```'
    expect(endsWithQuestion(msg)).toBe(true)
  })
  it('an unclosed/unbalanced fence is left as-is (not stripped)', () => {
    // No closing ``` — if the fence were (incorrectly) stripped anyway, the
    // trailing "Want to proceed?" line would vanish along with it and the
    // scan would land on "Notes here." (no `?`) → false. Because an unclosed
    // fence must NOT be stripped, the line survives and is scanned normally.
    const msg = 'Notes here.\n```\nWant to proceed?'
    expect(endsWithQuestion(msg)).toBe(true)
  })
})

describe('phrase list (prose asks without a question mark)', () => {
  it('detects common ask-phrases in the last 2 non-empty lines', () => {
    expect(endsWithQuestion('Two options exist.\nLet me know which one you prefer.')).toBe(true)
    expect(endsWithQuestion('I can do A or B.\nPlease confirm before I continue.')).toBe(true)
    expect(endsWithQuestion('Tell me if you want the second variant.')).toBe(true)
  })
  it('stays false for plain statements', () => {
    expect(endsWithQuestion('Done. I updated the config and all tests pass.')).toBe(false)
    expect(endsWithQuestion('The build finished.\nEverything is green.')).toBe(false)
  })
})
