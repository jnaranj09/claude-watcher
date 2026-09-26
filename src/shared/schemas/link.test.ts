// External links — the renderer → main arg of CH.linkOpenExternal.
import { describe, it, expect } from 'vitest'
import { LINK_URL_MAX_LENGTH, LinkOpenExternalSchema } from './link'

describe('LinkOpenExternalSchema', () => {
  it('accepts a url string', () => {
    expect(LinkOpenExternalSchema.parse({ url: 'https://example.com/' })).toEqual({
      url: 'https://example.com/'
    })
  })
  it('fails closed on a missing, empty or non-string url', () => {
    expect(LinkOpenExternalSchema.safeParse({}).success).toBe(false)
    expect(LinkOpenExternalSchema.safeParse({ url: '' }).success).toBe(false)
    expect(LinkOpenExternalSchema.safeParse({ url: 42 }).success).toBe(false)
  })
  it('fails closed on a url past the length cap', () => {
    const url = `https://example.com/${'a'.repeat(LINK_URL_MAX_LENGTH)}`
    expect(LinkOpenExternalSchema.safeParse({ url }).success).toBe(false)
  })
  it('fails closed on an extra key', () => {
    expect(LinkOpenExternalSchema.safeParse({ url: 'https://a.b/', x: 1 }).success).toBe(false)
  })
})
