// Server health rules the mutation run (StrykerJS) found no node test covering: the push keeps
// its fields and accepts any real port.
import { describe, it, expect } from 'vitest'
import { ServerHealthSchema } from './serverHealth'

describe('ServerHealthSchema', () => {
  it.each([1, 9279, 65535])('keeps the health of a hook server on port %i', (hookPort) => {
    const health = { hooks: 'ok', hookPort, api: 'off' }
    expect(ServerHealthSchema.parse(health)).toEqual(health)
  })
})
