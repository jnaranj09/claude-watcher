// File history rules the mutation run (StrykerJS) showed no test pinned: a version's hash is
// exactly 64 hex characters, anchored at both ends.
import { describe, it, expect } from 'vitest'
import { FileVersionSchema } from './fileHistory'

const HASH = 'a'.repeat(64)

describe('FileVersionSchema — hash', () => {
  it.each([
    ['text before the hash', `x${HASH}`],
    ['text after the hash', `${HASH}x`]
  ])('refuses a hash with %s', (_case, hash) => {
    const version = { id: 'v1', path: '/w/CLAUDE.md', hash, size: 1, seenAt: 1 }
    expect(FileVersionSchema.safeParse(version).success).toBe(false)
  })
})
