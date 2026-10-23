// The `/mod/prompt` boundary: strict, fail closed. The mod's side of the same shape is pinned in
// tests/main/modPromptContract.test.ts (its built body parses here).
import { describe, it, expect } from 'vitest'
import { ModPromptSchema } from './modPrompt'

const SID = 'aaaaaaaa-0000-4000-8000-0000000000aa'

describe('ModPromptSchema', () => {
  it('parses an operator origin', () => {
    expect(
      ModPromptSchema.safeParse({ version: 1, sessionId: SID, origin: 'composer' }).success
    ).toBe(true)
  })

  it('passes an origin it does not know (claude adds kinds; not enum-locked)', () => {
    expect(
      ModPromptSchema.safeParse({ version: 1, sessionId: SID, origin: 'some-new-kind' }).success
    ).toBe(true)
  })

  it('refuses a key the mod never sends (the prompt text)', () => {
    expect(
      ModPromptSchema.safeParse({ version: 1, sessionId: SID, origin: 'composer', text: 'hi' })
        .success
    ).toBe(false)
  })

  it('refuses an empty session id', () => {
    expect(
      ModPromptSchema.safeParse({ version: 1, sessionId: '', origin: 'composer' }).success
    ).toBe(false)
  })

  it('refuses another version', () => {
    expect(
      ModPromptSchema.safeParse({ version: 2, sessionId: SID, origin: 'composer' }).success
    ).toBe(false)
  })
})
