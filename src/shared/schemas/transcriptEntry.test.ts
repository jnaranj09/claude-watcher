// The one transcript-line schema: the new keys are read loosely (ruling R6), so no new key can
// fail a line. Fixtures follow the shapes claude 2.1.323 wrote (synthetic text).
import { describe, expect, it } from 'vitest'
import { TranscriptEntrySchema } from './transcriptEntry'

const toolUse = {
  type: 'assistant',
  uuid: 'u2',
  isSidechain: false,
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]
  }
}

const toolResult = {
  type: 'user',
  uuid: 'u3',
  promptSource: 'sdk',
  toolUseResult: 'Exit code 2',
  message: {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'Exit code 2', is_error: true }
    ]
  }
}

describe('TranscriptEntrySchema', () => {
  it('reads a tool_use part and a tool_result part, and still passes a line with unknown keys', () => {
    expect(TranscriptEntrySchema.parse(toolUse)).toMatchObject({
      uuid: 'u2',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]
      }
    })
    expect(TranscriptEntrySchema.parse(toolResult)).toMatchObject({
      uuid: 'u3',
      toolUseResult: 'Exit code 2',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }]
      }
    })

    const unknown = { ...toolResult, cwd: '/work/acme/shop', gitBranch: 'main' }
    expect(TranscriptEntrySchema.safeParse(unknown).success).toBe(true)
  })

  it('a line whose new keys carry unexpected types still parses', () => {
    const odd = {
      type: 'user',
      uuid: 7,
      isMeta: 'yes',
      isSidechain: 1,
      isCompactSummary: [],
      promptSource: {},
      toolUseResult: null,
      message: { content: [{ type: 9, is_error: 'x', content: 3, id: false, input: 'raw' }] }
    }
    expect(TranscriptEntrySchema.safeParse(odd).success).toBe(true)
  })
})
