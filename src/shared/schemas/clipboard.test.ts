// Terminal clipboard feature — unit tests for ClipboardWriteTextSchema.
//
// Gate: `unit` (jsdom) project — pure schema, no Electron.
// Covers: valid write arg, rejection on bad types, failure path exposes only
// path+code (never the text value), as required by .claude/rules/zod-boundaries.md.
// [Source: spec-terminal-clipboard.md §Gate note; .claude/rules/zod-boundaries.md]

import { describe, it, expect } from 'vitest'
import { ClipboardWriteTextSchema } from './clipboard'

describe('ClipboardWriteTextSchema', () => {
  it('accepts a valid { text: string } arg', () => {
    const result = ClipboardWriteTextSchema.safeParse({ text: 'hello world' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.text).toBe('hello world')
  })

  it('accepts an empty string text (writing an empty selection is valid)', () => {
    const result = ClipboardWriteTextSchema.safeParse({ text: '' })
    expect(result.success).toBe(true)
  })

  it('rejects a missing text field', () => {
    const result = ClipboardWriteTextSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects a non-string text (number)', () => {
    const result = ClipboardWriteTextSchema.safeParse({ text: 42 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-string text (null)', () => {
    const result = ClipboardWriteTextSchema.safeParse({ text: null })
    expect(result.success).toBe(false)
  })

  it('rejects null entirely', () => {
    const result = ClipboardWriteTextSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  it('rejects undefined entirely', () => {
    const result = ClipboardWriteTextSchema.safeParse(undefined)
    expect(result.success).toBe(false)
  })

  it('rejects a raw string (not wrapped in an object)', () => {
    const result = ClipboardWriteTextSchema.safeParse('hello')
    expect(result.success).toBe(false)
  })

  // Guardrail #6 compliance: the Zod error MUST expose path+code, NOT the raw text
  // value. This test asserts the failure carries the field path so callers can log
  // path+code only without touching the value. (The logger decision is the caller's;
  // the schema just provides the path.)
  it('parse failure exposes the field path ("text") for path+code logging', () => {
    const result = ClipboardWriteTextSchema.safeParse({ text: 99 })
    expect(result.success).toBe(false)
    if (!result.success) {
      // The first issue must identify the "text" field by path.
      const issue = result.error.issues[0]
      expect(issue).toBeDefined()
      expect(issue?.path).toEqual(['text'])
      // A code is always present on a Zod issue.
      expect(typeof issue?.code).toBe('string')
    }
  })

  it('parse() throws on a bad arg (used by main handler for fail-closed behaviour)', () => {
    expect(() => ClipboardWriteTextSchema.parse({ text: true })).toThrow()
  })
})
