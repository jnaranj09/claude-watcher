// API wire rules the mutation run (StrykerJS) showed no test pinned: the last frame of a stream
// keeps an id of several characters.
import { describe, it, expect } from 'vitest'
import { ApiSessionRemovedSchema } from './api'

describe('ApiSessionRemovedSchema', () => {
  it('keeps a session id of several characters', () => {
    expect(ApiSessionRemovedSchema.parse({ id: 'sess-1' })).toEqual({ id: 'sess-1' })
  })
})
