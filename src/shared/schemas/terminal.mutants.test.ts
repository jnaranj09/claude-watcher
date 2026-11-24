// Terminal arg rules the mutation run (StrykerJS) showed no test pinned: a stop keeps an open
// token of several characters.
import { describe, it, expect } from 'vitest'
import { TerminalStopSchema } from './terminal'

describe('TerminalStopSchema', () => {
  it('keeps an open token of several characters', () => {
    const stop = { terminalId: 'term-1', openToken: 'tok-1' }
    expect(TerminalStopSchema.parse(stop)).toEqual(stop)
  })
})
