import { describe, it, expect } from 'vitest'
import { approvalStatusChange } from './approvalKey'

describe('approvalStatusChange (R4)', () => {
  it.each(['\r', '1', '2'])('%j on an open permission prompt → Working', (key) => {
    expect(approvalStatusChange('NeedsPermission', key)).toEqual({
      kind: 'status',
      status: 'Working'
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
