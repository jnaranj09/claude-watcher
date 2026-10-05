import { describe, it, expect, vi } from 'vitest'
import { applyApprovalKey, approvalStatusChange } from './approvalKey'

describe('approvalStatusChange (R4)', () => {
  it.each(['\r', '1', '2'])('%j on an open permission prompt → Working', (key) => {
    expect(approvalStatusChange('NeedsPermission', key)).toEqual({
      kind: 'status',
      status: 'Working',
      fromKey: true
    })
  })

  it('the "no" option, Escape, other keys and multi-byte input change nothing', () => {
    for (const data of ['3', '\x1b', 'y', '\n', '12', '1\r', 'run 1', '\x1b[A']) {
      expect(approvalStatusChange('NeedsPermission', data)).toBeNull()
    }
  })

  it('Enter on any other status is an ordinary keystroke', () => {
    for (const status of ['NeedsAttention', 'YourTurn', 'Working', 'WaitingForInput', undefined]) {
      expect(approvalStatusChange(status, '\r')).toBeNull()
    }
  })
})

describe('applyApprovalKey (the keyLaunched seam)', () => {
  it('logs and returns the deltas when the key moved the card', () => {
    const log = vi.fn()
    expect(applyApprovalKey('NeedsPermission', '\r', () => ['d'], log)).toEqual(['d'])
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('logs nothing when the reducer ignored the key (open AskUserQuestion, ST-2)', () => {
    const log = vi.fn()
    expect(applyApprovalKey('NeedsPermission', '\r', () => [], log)).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('never calls the reducer for a key that is not an answer', () => {
    const apply = vi.fn(() => ['d'])
    const log = vi.fn()
    expect(applyApprovalKey('Working', '\r', apply, log)).toEqual([])
    expect(apply).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})
