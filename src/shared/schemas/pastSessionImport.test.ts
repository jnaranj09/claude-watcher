import { describe, it, expect } from 'vitest'
import { PastSessionImportSchema } from './pastSession'
import { TranscriptInfoLineSchema } from './transcriptInfo'

const ID = '93b82f21-709b-41a5-8d8a-8b1a4af499bf'

describe('PastSessionImportSchema', () => {
  it('accepts a claude session id and a workspace id', () => {
    expect(PastSessionImportSchema.parse({ id: ID, workspaceId: 'w1' })).toEqual({
      id: ID,
      workspaceId: 'w1'
    })
  })
  it('accepts an upper-case id (claude prints lower case, a paste may not)', () => {
    expect(
      PastSessionImportSchema.safeParse({ id: ID.toUpperCase(), workspaceId: 'w1' }).success
    ).toBe(true)
  })
  it.each([
    ['not a uuid', { id: 'abc', workspaceId: 'w1' }],
    ['uuid with spaces (the renderer trims)', { id: ` ${ID} `, workspaceId: 'w1' }],
    ['uuid with a path tail', { id: `${ID}/../x`, workspaceId: 'w1' }],
    ['missing workspace', { id: ID }],
    ['empty workspace', { id: ID, workspaceId: '' }],
    ['extra key', { id: ID, workspaceId: 'w1', cwd: '/tmp' }]
  ])('rejects %s', (_label, raw) => {
    expect(PastSessionImportSchema.safeParse(raw).success).toBe(false)
  })
})

describe('TranscriptInfoLineSchema', () => {
  it('keeps the known fields and lets unknown ones pass', () => {
    const line = { type: 'user', cwd: '/home/op/api', message: { x: 1 } }
    expect(TranscriptInfoLineSchema.parse(line)).toMatchObject({
      type: 'user',
      cwd: '/home/op/api'
    })
  })
  it('rejects a line whose cwd is not a string', () => {
    expect(TranscriptInfoLineSchema.safeParse({ cwd: 5 }).success).toBe(false)
  })
  it('rejects an empty title', () => {
    expect(TranscriptInfoLineSchema.safeParse({ type: 'ai-title', aiTitle: '' }).success).toBe(
      false
    )
  })
})
