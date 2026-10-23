// Unit tests for the `Needs you:` marker detector. Runs under the `main-unit` Vitest project.

import { describe, it, expect } from 'vitest'
import { NEEDS_YOU_MARKER, endsWithNeedsYou } from './needsYouMarker'

describe('endsWithNeedsYou', () => {
  it('owns the literal token claude is told to write', () => {
    expect(NEEDS_YOU_MARKER).toBe('Needs you:')
  })

  it('marker on the last line → true', () => {
    expect(endsWithNeedsYou('Done.\n\nNeeds you: the SSH key.')).toBe(true)
  })

  it.each(['**Needs you:** the key', '> Needs you: x', '- Needs you: x', '_Needs you:_ x'])(
    'wrapped form %j → true',
    (msg) => {
      expect(endsWithNeedsYou(msg)).toBe(true)
    }
  )

  it('marker in a non-English reply → true', () => {
    expect(endsWithNeedsYou('Hecho.\nNeeds you: el nombre del paquete.')).toBe(true)
  })

  it('marker followed by a trailing fenced block → true', () => {
    expect(endsWithNeedsYou('Needs you: run this\n```\nnpm i\n```')).toBe(true)
  })

  it('a mid-message quote with prose after it → false', () => {
    const msg =
      'I will add a Needs you: line later.\n\nSummary: all good.\nNothing else.\nDone.\nBye.'
    expect(endsWithNeedsYou(msg)).toBe(false)
  })

  it('"Needs you" without the colon right after → false', () => {
    expect(endsWithNeedsYou('Needs you to know it works.')).toBe(false)
  })

  it('undefined / empty / whitespace → false', () => {
    expect(endsWithNeedsYou(undefined)).toBe(false)
    expect(endsWithNeedsYou('')).toBe(false)
    expect(endsWithNeedsYou('   ')).toBe(false)
  })
})
