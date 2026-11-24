// Launch schema rules the mutation run (StrykerJS) showed no test pinned: the control-character
// bounds, and the launch-requested, archive and delete args keeping their ids.
import { describe, it, expect } from 'vitest'
import {
  isControlCodePoint,
  LaunchRequestedSchema,
  SessionArchiveSchema,
  SessionDeleteSchema
} from './launch'

describe('isControlCodePoint', () => {
  it.each([
    ['the last C0 control (U+001F)', 0x1f],
    ['the last C1 control (U+009F)', 0x9f]
  ])('counts %s as a control character', (_case, cp) => {
    expect(isControlCodePoint(cp)).toBe(true)
  })
})

describe('the launch and exit args', () => {
  it('a launch-requested arg keeps its terminal id, label and workspace', () => {
    const arg = { terminalId: 'term-1', label: 'HT-1 fix', workspaceId: 'default' }
    expect(LaunchRequestedSchema.parse(arg)).toEqual(arg)
  })

  it('an archive arg keeps its terminal id', () => {
    expect(SessionArchiveSchema.parse({ terminalId: 'term-1' })).toEqual({ terminalId: 'term-1' })
  })

  it('a delete arg keeps its terminal id and session id', () => {
    const arg = { terminalId: 'term-1', sessionId: 'sess-1' }
    expect(SessionDeleteSchema.parse(arg)).toEqual(arg)
  })
})
