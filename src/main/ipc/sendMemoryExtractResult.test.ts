import { describe, it, expect, vi } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import { NO_COUNTS, type MemoryExtractResult } from '../../shared/schemas/memory'
import { sendMemoryExtractResult } from './sendMemoryExtractResult'

const NAME = 'demo session'
const SAVED: MemoryExtractResult = {
  sessionName: NAME,
  trigger: 'end',
  outcome: 'saved',
  counts: { ...NO_COUNTS, specifics: 1 },
  reason: null
}

function fakeWc(destroyed = false): {
  wc: { isDestroyed(): boolean; send(channel: string, payload: unknown): void }
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  return { wc: { isDestroyed: () => destroyed, send }, send }
}

describe('sendMemoryExtractResult', () => {
  it('sends a valid result and drops one with a negative count with a code, never the name', () => {
    const { wc, send } = fakeWc()
    const log = vi.fn()
    sendMemoryExtractResult(wc, SAVED, log)
    expect(send).toHaveBeenCalledWith(CH.memoryExtractResult, SAVED)
    expect(log).not.toHaveBeenCalled()

    send.mockClear()
    sendMemoryExtractResult(wc, { ...SAVED, counts: { ...NO_COUNTS, tasks: -1 } }, log)
    expect(send).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(line).toContain('code=memory_extract_result_invalid')
    expect(line).toContain('path=counts.tasks')
    expect(line).toContain('issue=too_small')
    expect(line).not.toContain(NAME)
  })

  it('sends nothing to a destroyed window and does not throw', () => {
    const { wc, send } = fakeWc(true)
    const log = vi.fn()
    expect(() => sendMemoryExtractResult(wc, SAVED, log)).not.toThrow()
    expect(send).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})
