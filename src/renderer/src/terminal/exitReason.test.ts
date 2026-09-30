import { describe, expect, it } from 'vitest'
import { exitReasonCopy, resumeErrorCopy } from './exitReason'

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

describe('exitReasonCopy — the shell pane names its own exit', () => {
  it('Shell exited with code N.', () => {
    expect(exitReasonCopy('Shell', { exitCode: 0 })).toBe('Shell exited with code 0.')
    expect(exitReasonCopy('Shell', { exitCode: 1, signal: 9 })).toBe(
      'Shell was stopped by SIGKILL (signal 9).'
    )
  })
})
