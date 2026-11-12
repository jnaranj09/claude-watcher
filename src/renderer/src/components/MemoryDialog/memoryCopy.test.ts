// Memory's refusal copy: mapped from the code inside Electron's wrapped rejection, never from the
// message; and the one code the renderer cannot import from main is pinned to main's file.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { MEMORY_UNAVAILABLE, memoryErrorCopy } from './memoryCopy'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'

const wrapped = (code: string): Error =>
  new Error(`Error invoking remote method 'memory:edit': Error: ${code}`)

describe('memoryErrorCopy', () => {
  it.each([
    ['memory_not_found', 'That memory no longer exists.'],
    ['memory_version_not_found', 'That version is no longer in the history.'],
    ['memory_unavailable', 'Memory is not available. Reopen the app to try again.'],
    ['memory_read_failed', 'Could not load memory.'],
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

describe('memory_unavailable — the code main throws while it has no store', () => {
  it('is the token src/main/memory/memoryIpc.ts throws', () => {
    const main = readFileSync(join(process.cwd(), 'src/main/memory/memoryIpc.ts'), 'utf8')
    expect(main).toContain(`export const MEMORY_UNAVAILABLE = '${MEMORY_UNAVAILABLE}'`)
  })
})
