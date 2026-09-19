import { describe, it, expect } from 'vitest'
import { splitTagPath } from './tagPath'

describe('splitTagPath — display-only hierarchy on the LAST slash', () => {
  it.each([
    ['acme', { parent: null, leaf: 'acme', depth: 0 }],
    ['acme/prod', { parent: 'acme', leaf: 'prod', depth: 1 }],
    ['acme/prod/eu', { parent: 'acme/prod', leaf: 'eu', depth: 2 }]
  ])('%s', (name, expected) => {
    expect(splitTagPath(name)).toEqual(expected)
  })
  it.each(['/a', 'a/', 'a//b', '/', 'a/ /b'])(
    'a malformed path (%s) is depth 0 with the whole name as the leaf — never an empty segment',
    (name) => {
      expect(splitTagPath(name)).toEqual({ parent: null, leaf: name, depth: 0 })
    }
  )
})
