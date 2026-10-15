// Terminal clipboard feature — unit tests for ClipboardWriteTextSchema.
//
// Gate: `shared-node` project — pure schema, no Electron.
// Covers: valid write arg (empty text included) and a missing text field. A wrong type is
// zod's own `z.string()` check, not tested here. The never-log rule lives at the handler
// (`registerAppIpc.ts` parses, throws and logs nothing), per .claude/rules/zod-boundaries.md.
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
})
