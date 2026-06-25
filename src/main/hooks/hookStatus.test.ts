// Hook-status feature — unit tests for the hookStatus mapper.
//
// Runs under the `main-unit` Vitest project (node).
// Tests the full mapping table from the I/O matrix in the spec.
// [spec Tasks; spec I/O & Edge-Case Matrix]

import { describe, it, expect } from 'vitest'
import { hookStatus } from './hookStatus'

describe('hookStatus — event-name to HookStatusChange mapper', () => {
  // Active events → Working
  it.each(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart'])(
    '%s → { kind: "status", status: "Working" }',
    (name) => {
      const result = hookStatus(name)
      expect(result).toEqual({ kind: 'status', status: 'Working' })
    }
  )

  it('Stop → { kind: "status", status: "WaitingForInput" }', () => {
    expect(hookStatus('Stop')).toEqual({ kind: 'status', status: 'WaitingForInput' })
  })

  it('SessionEnd → { kind: "removed" }', () => {
    expect(hookStatus('SessionEnd')).toEqual({ kind: 'removed' })
  })

  it('unknown event names → null (never fail-closed, future events pass)', () => {
    expect(hookStatus('UnknownEvent')).toBeNull()
    expect(hookStatus('')).toBeNull()
    expect(hookStatus('Notification')).toBeNull()
    expect(hookStatus('SomeNewClaudeEvent')).toBeNull()
  })

  it('is a pure function — does not throw or mutate state', () => {
    // Call multiple times to confirm purity
    expect(hookStatus('Stop')).toEqual({ kind: 'status', status: 'WaitingForInput' })
    expect(hookStatus('Stop')).toEqual({ kind: 'status', status: 'WaitingForInput' })
    expect(hookStatus('SessionEnd')).toEqual({ kind: 'removed' })
    expect(hookStatus('PreToolUse')).toEqual({ kind: 'status', status: 'Working' })
  })
})
