import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'
import { TOKEN_DOCS } from './tokenDocs'

describe('TOKEN_DOCS', () => {
  it('has a non-empty one-line meaning for every token and nothing else', () => {
    expect(Object.keys(TOKEN_DOCS).sort()).toEqual(Object.keys(TOKENS).sort())
    for (const [name, doc] of Object.entries(TOKEN_DOCS)) {
      expect(doc.trim().length, name).toBeGreaterThan(0)
      expect(doc, name).not.toMatch(/[\n|]/) // one markdown table cell
    }
  })
})
