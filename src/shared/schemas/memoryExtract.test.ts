import { describe, expect, it } from 'vitest'
import { EXTRACT_JSON_SCHEMA, EXTRACT_LIMITS, ExtractOutputSchema } from './memoryExtract'
import { MEMORY_LIMITS } from './memory'

const candidate = {
  type: 'fact',
  action: 'add',
  id: null,
  head: 'Deploy',
  body: 'make deploy',
  check: null,
  leftWith: null,
  evidence: 'run make deploy'
}

describe('EXTRACT_LIMITS', () => {
  it('a quote the check keeps fits the stored source quote', () => {
    expect(EXTRACT_LIMITS.evidenceMax).toBe(MEMORY_LIMITS.sourceQuote)
  })
})

describe('ExtractOutputSchema', () => {
  it('accepts up to 12 candidates', () => {
    const twelve = Array.from({ length: EXTRACT_LIMITS.candidates }, () => candidate)
    expect(ExtractOutputSchema.safeParse({ candidates: twelve, note: '' }).success).toBe(true)
  })

  it('refuses a 13th candidate, an unknown key and an unknown type', () => {
    const thirteen = Array.from({ length: EXTRACT_LIMITS.candidates + 1 }, () => candidate)
    expect(ExtractOutputSchema.safeParse({ candidates: thirteen, note: '' }).success).toBe(false)
    expect(
      ExtractOutputSchema.safeParse({ candidates: [{ ...candidate, extra: 1 }], note: '' }).success
    ).toBe(false)
    expect(
      ExtractOutputSchema.safeParse({ candidates: [{ ...candidate, type: 'goal' }], note: '' })
        .success
    ).toBe(false)
  })

  it('refuses an unknown key at the top level and a string over 4,000 characters', () => {
    expect(ExtractOutputSchema.safeParse({ candidates: [], note: '', extra: 1 }).success).toBe(
      false
    )
    const long = { ...candidate, body: 'b'.repeat(EXTRACT_LIMITS.outputStringChars + 1) }
    expect(ExtractOutputSchema.safeParse({ candidates: [long], note: '' }).success).toBe(false)
  })

  it('cuts a note to 500 characters', () => {
    expect(ExtractOutputSchema.parse({ candidates: [], note: ' ' + 'n'.repeat(600) }).note).toBe(
      'n'.repeat(500)
    )
  })

  it('trims a note', () => {
    expect(ExtractOutputSchema.parse({ candidates: [], note: '  carry on  ' }).note).toBe(
      'carry on'
    )
  })
})

describe('EXTRACT_JSON_SCHEMA', () => {
  it('the JSON schema text parses and names the same candidate keys as the Zod schema', () => {
    const props = JSON.parse(EXTRACT_JSON_SCHEMA).properties.candidates.items.properties
    expect(Object.keys(props).sort()).toEqual([
      'action',
      'body',
      'check',
      'evidence',
      'head',
      'id',
      'leftWith',
      'type'
    ])
    expect(Object.keys(props).sort()).toEqual(Object.keys(candidate).sort())
  })
})
