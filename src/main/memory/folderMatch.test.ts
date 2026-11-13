import { describe, it, expect } from 'vitest'
import { foldersRelated } from './folderMatch'

describe('foldersRelated', () => {
  it.each([
    ['/a/b', '/a/b', true],
    ['/a/b', '/a/b/c', true],
    ['/a/b/c', '/a/b', true],
    ['/a/b', '/a/bc', false],
    ['/a/b/', '/a/b', true],
    ['/a/b/', '/a/b/c', true]
  ])('%s and %s → %s', (a, b, out) => {
    expect(foldersRelated(a, b)).toBe(out)
  })

  it('the root holds every folder', () => {
    expect(foldersRelated('/', '/a/b')).toBe(true)
  })

  it('two sibling folders are not related', () => {
    expect(foldersRelated('/a/b', '/a/c')).toBe(false)
  })
})
