// Context path rules the mutation run (StrykerJS) showed no test pinned: what counts as an
// absolute path and as an instruction file, and the setup-changed push keeping its id.
import { describe, it, expect } from 'vitest'
import { isAbsolutePath, isInstructionPath, SessionSetupChangedSchema } from './contextIpc'

describe('isAbsolutePath', () => {
  it.each([
    ['a POSIX path', '/work/CLAUDE.md', true],
    ['a Windows path with a backslash', 'C:\\work\\CLAUDE.md', true],
    ['a relative path holding a slash', 'docs/CLAUDE.md', false],
    ['a relative path holding a drive-like part', 'x/C:/CLAUDE.md', false]
  ])('reads %s as absolute: %s', (_case, path, absolute) => {
    expect(isAbsolutePath(path)).toBe(absolute)
  })
})

describe('isInstructionPath', () => {
  it('refuses a path where .md is not the end', () => {
    expect(isInstructionPath('/work/CLAUDE.md.bak')).toBe(false)
  })
})

describe('SessionSetupChangedSchema', () => {
  it('keeps the session id of the push', () => {
    expect(SessionSetupChangedSchema.parse({ sessionId: 'sess-1' })).toEqual({
      sessionId: 'sess-1'
    })
  })
})
