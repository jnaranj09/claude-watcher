import { describe, expect, it } from 'vitest'
import { nextShowAllTags } from './showAllTags'

describe('nextShowAllTags', () => {
  const known = new Set(['default', 'ws-a', 'ws-b'])

  it('turning it on adds the workspace; other workspaces keep their choice', () => {
    expect(nextShowAllTags({ 'ws-a': true }, 'ws-b', true, known)).toEqual({
      'ws-a': true,
      'ws-b': true
    })
  })

  it('turning it off removes only that workspace', () => {
    expect(nextShowAllTags({ 'ws-a': true, 'ws-b': true }, 'ws-a', false, known)).toEqual({
      'ws-b': true
    })
  })

  it('drops workspaces that no longer exist', () => {
    expect(nextShowAllTags({ gone: true, 'ws-a': true }, 'default', true, known)).toEqual({
      'ws-a': true,
      default: true
    })
  })
})
