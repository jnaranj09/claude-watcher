import { describe, it, expect } from 'vitest'
import {
  EMPTY_TAGS_FILE,
  SessionSetTagsSchema,
  TAG_COLORS,
  TAGS_FILE_VERSION,
  TagSaveSchema,
  TagSchema,
  TagsFileSchema
} from './tag'
import { WORKSPACE_COLORS } from './workspace'

const ROW = { id: 't1', name: 'prod', color: 'rose', workspaceId: null }

describe('TagSchema', () => {
  it('accepts a global and a workspace-scoped tag', () => {
    expect(TagSchema.parse(ROW)).toEqual(ROW)
    expect(TagSchema.parse({ ...ROW, workspaceId: 'w1' }).workspaceId).toBe('w1')
  })

  // W-11 fault injection: removing `.default(null)` from TagSchema.workspaceId turns this red.
  it('reads a row written without workspaceId back as GLOBAL (null)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workspaceId: _drop, ...old } = ROW
    expect(TagSchema.parse(old).workspaceId).toBeNull()
  })

  it('offers exactly the six workspace colour names', () => {
    // Drift guard for the spec's "the same 6 names"
    expect([...TAG_COLORS]).toEqual([...WORKSPACE_COLORS])
  })

  it('fails closed on an unknown colour, a blank name, a control character and a blank id', () => {
    expect(TagSchema.safeParse({ ...ROW, color: 'teal' }).success).toBe(false)
    expect(TagSchema.safeParse({ ...ROW, name: '   ' }).success).toBe(false)
    expect(TagSchema.safeParse({ ...ROW, name: 'a\u0007b' }).success).toBe(false) // BEL control char
    expect(TagSchema.safeParse({ ...ROW, id: '' }).success).toBe(false)
  })

  it('accepts a 2-character name', () => {
    expect(TagSchema.parse({ ...ROW, name: 'P0' }).name).toBe('P0')
  })

  it('trims the name', () => {
    expect(TagSchema.parse({ ...ROW, name: '  prod ' }).name).toBe('prod')
  })
})

describe('TagSaveSchema', () => {
  it('no id ⇒ create; an id ⇒ update', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...create } = ROW
    expect(TagSaveSchema.parse(create)).toEqual(create)
    expect(TagSaveSchema.parse(ROW)).toEqual(ROW)
  })
})

describe('TagsFileSchema', () => {
  it('parses the empty v1 file and refuses any other version', () => {
    expect(TagsFileSchema.parse(EMPTY_TAGS_FILE)).toEqual({ version: TAGS_FILE_VERSION, tags: [] })
    expect(TagsFileSchema.safeParse({ version: 2, tags: [] }).success).toBe(false)
  })
})

describe('SessionSetTagsSchema', () => {
  it('collapses duplicate ids, keeping the first occurrence', () => {
    expect(SessionSetTagsSchema.parse({ sessionId: 's1', tagIds: ['a', 'b', 'a'] })).toEqual({
      sessionId: 's1',
      tagIds: ['a', 'b']
    })
  })

  it('fails closed on a blank session id or a blank tag id', () => {
    expect(SessionSetTagsSchema.safeParse({ sessionId: '', tagIds: [] }).success).toBe(false)
    expect(SessionSetTagsSchema.safeParse({ sessionId: 's1', tagIds: [''] }).success).toBe(false)
  })
})
