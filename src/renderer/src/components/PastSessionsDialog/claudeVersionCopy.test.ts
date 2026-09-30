// Action feedback (spec 2026-09-29 §2.4) — Past sessions → Open and the dead pane's Resume go
// through the same version gate as a launch; with the native box gone, the code needs copy.
import { describe, it, expect } from 'vitest'
import { pastSessionErrorMessage } from './pastSessionsView'
import { resumeErrorCopy } from '../../terminal/exitReason'

const wrapped = new Error(
  "Error invoking remote method 'past-sessions:open': Error: claude_version"
)

describe('claude_version copy', () => {
  it('Past sessions → Open names the floor', () => {
    expect(pastSessionErrorMessage(wrapped)).toBe(
      'Update claude to 2.1.245 or newer to open a past session'
    )
  })

  it("the dead pane's Resume names the floor", () => {
    expect(resumeErrorCopy(wrapped)).toBe('Update claude to 2.1.245 or newer to resume.')
  })
})
