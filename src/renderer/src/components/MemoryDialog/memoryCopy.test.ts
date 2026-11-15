// Memory's refusal copy: mapped from the code inside Electron's wrapped rejection, never from the
// message.
import { describe, it, expect } from 'vitest'
import { MEMORY_COPY, memoryErrorCopy } from './memoryCopy'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'

const wrapped = (code: string): Error =>
  new Error(`Error invoking remote method 'memory:edit': Error: ${code}`)

describe('memoryErrorCopy', () => {
  it.each([
    ['memory_not_found', 'That memory no longer exists.'],
    ['memory_version_not_found', 'That version is no longer in the history.'],
    ['memory_unavailable', 'Memory is not available. Reopen the app to try again.'],
    ['memory_read_failed', 'Could not load memory.'],
    ['memory_context_invalid', 'That goal or tag no longer exists.'],
    ['store_write_failed', STORE_WRITE_FAILED_COPY]
  ])('maps %s to its sentence', (code, copy) => {
    expect(memoryErrorCopy(wrapped(code), 'Could not save memory.')).toBe(copy)
  })

  it('an unknown failure is the action fallback, never the message', () => {
    expect(memoryErrorCopy(new Error('disk on fire at /home/x'), 'Could not save memory.')).toBe(
      'Could not save memory.'
    )
  })
})

describe('MEMORY_COPY.runs', () => {
  it.each([
    [0, '0 runs'],
    [1, '1 run'],
    [3, '3 runs']
  ])('%i is "%s"', (n, words) => {
    expect(MEMORY_COPY.runs(n)).toBe(words)
  })
})
