import { describe, expect, it } from 'vitest'
import { resumeErrorCopy } from './exitReason'

describe('resumeErrorCopy — the dead pane maps a refused Resume to copy', () => {
  it('UX-14: a conversation running outside the app', () => {
    expect(
      resumeErrorCopy(
        new Error("Error invoking remote method 'x': Error: session_running_elsewhere")
      )
    ).toBe('This conversation is running in another terminal. Close it there first.')
  })

  it('anything unmapped is the generic line, never the message', () => {
    expect(resumeErrorCopy(new Error('/home/secret'))).toBe('Could not resume the conversation.')
  })
})
