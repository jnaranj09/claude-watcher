// Extract output rules the mutation run (StrykerJS) showed no test pinned: every candidate type,
// action and `leftWith` the model may send is accepted.
import { describe, it, expect } from 'vitest'
import { ExtractOutputSchema } from './memoryExtract'

const CANDIDATE = {
  type: 'specific',
  action: 'add',
  id: null,
  head: 'port',
  body: null,
  check: null,
  leftWith: null,
  evidence: 'the port is 9281'
}

describe('ExtractOutputSchema — candidate values', () => {
  it.each([
    ['type task', { type: 'task' }],
    ['type episode', { type: 'episode' }],
    ['action update', { action: 'update' }],
    ['action none', { action: 'none' }],
    ['leftWith operator', { leftWith: 'operator' }],
    ['leftWith session', { leftWith: 'session' }]
  ])('accepts a candidate with %s', (_case, part) => {
    const output = { candidates: [{ ...CANDIDATE, ...part }], note: '' }
    expect(ExtractOutputSchema.safeParse(output).success).toBe(true)
  })
})
