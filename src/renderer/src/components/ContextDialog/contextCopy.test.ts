// Context's copy reads a refusal by its CODE inside Electron's wrapped rejection (design.md
// Feedback). The codes come from main's one list, so a new code is read without a second edit.
import { describe, it, expect } from 'vitest'
import { CONTEXT_REFUSAL_CODES } from '../../../../shared/schemas/contextIpc'
import { CONTEXT_COPY, DROP_REASON_COPY, contextRefusal } from './contextCopy'
import { DROP_REASONS, type DropReason } from '../../../../shared/schemas/memory'

describe('contextRefusal', () => {
  it.each(CONTEXT_REFUSAL_CODES)('reads %s from a wrapped rejection', (code) => {
    const err = new Error(`Error invoking remote method 'file:open': Error: ${code}`)
    expect(contextRefusal(err)).toBe(code)
  })

  it('reads nothing from an error that holds no code', () => {
    expect(contextRefusal(new Error('boom'))).toBeNull()
  })
})

// Memory phase 2: why extraction dropped a candidate, in plain words (never the raw code).
describe('DROP_REASON_COPY', () => {
  it.each<[DropReason, string]>([
    ['evidence_not_found', 'Not found in the transcript'],
    ['secret', 'Held a secret'],
    ['invalid', 'Not valid'],
    ['operator_item', 'You wrote that item'],
    ['tasks_off', 'Tasks are off'],
    ['claude_only', 'Only Claude said it']
  ])('%s reads %s', (reason, copy) => {
    expect(DROP_REASON_COPY[reason]).toBe(copy)
  })

  it('says why an update only claude supported was dropped', () => {
    expect(DROP_REASON_COPY.claude_only).toBe('Only Claude said it')
  })

  it('has a sentence for every reason main can drop for', () => {
    expect(Object.keys(DROP_REASON_COPY)).toEqual([...DROP_REASONS])
  })

  it('the Dropped heading and its empty sentence', () => {
    expect(CONTEXT_COPY.dropped).toBe('Dropped')
    expect(CONTEXT_COPY.nothingDropped).toBe('Nothing dropped.')
  })
})
