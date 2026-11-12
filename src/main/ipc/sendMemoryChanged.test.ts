import { describe, it, expect, vi } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import { MemoryChangedSchema } from '../../shared/schemas/memory'
import { sendMemoryChanged } from './sendMemoryChanged'

function fakeWc(destroyed = false): { wc: Electron.WebContents; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return { wc: { isDestroyed: () => destroyed, send } as unknown as Electron.WebContents, send }
}

describe('sendMemoryChanged', () => {
  it('sends an empty payload that passes its schema on memory:changed', () => {
    const { wc, send } = fakeWc()
    sendMemoryChanged(wc)
    expect(send).toHaveBeenCalledWith(CH.memoryChanged, {})
    expect(MemoryChangedSchema.safeParse(send.mock.calls[0]?.[1]).success).toBe(true)
  })

  it('sends nothing to a destroyed window', () => {
    const { wc, send } = fakeWc(true)
    sendMemoryChanged(wc)
    expect(send).not.toHaveBeenCalled()
  })
})
