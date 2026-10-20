// Context's copy reads a refusal by its CODE inside Electron's wrapped rejection (design.md
// Feedback). The codes come from main's one list, so a new code is read without a second edit.
import { describe, it, expect } from 'vitest'
import { CONTEXT_REFUSAL_CODES } from '../../../../shared/schemas/contextIpc'
import { contextRefusal } from './contextCopy'

describe('contextRefusal', () => {
  it.each(CONTEXT_REFUSAL_CODES)('reads %s from a wrapped rejection', (code) => {
    const err = new Error(`Error invoking remote method 'file:open': Error: ${code}`)
    expect(contextRefusal(err)).toBe(code)
  })

  it('reads nothing from an error that holds no code', () => {
    expect(contextRefusal(new Error('boom'))).toBeNull()
  })
})
