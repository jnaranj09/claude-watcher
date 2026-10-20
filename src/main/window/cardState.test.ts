// What a card carries beside the reducer, and must follow when the card moves (`/clear` re-keys
// it) or leaves: its pending rename and its Context setup (spec 2026-10-18 §7).
import { describe, it, expect, vi } from 'vitest'
import { dropCardState, moveCardState } from './cardState'

type Rebind = (oldId: string, newId: string) => void
type Forget = (id: string) => void
function deps(): {
  pendingTitles: {
    rebind: ReturnType<typeof vi.fn<Rebind>>
    forget: ReturnType<typeof vi.fn<Forget>>
  }
  sessionSetup: {
    rebind: ReturnType<typeof vi.fn<Rebind>>
    forget: ReturnType<typeof vi.fn<Forget>>
  }
} {
  return {
    pendingTitles: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() },
    sessionSetup: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() }
  }
}

describe('card state', () => {
  it('moves the pending rename and the Context setup to the new id', () => {
    const d = deps()
    moveCardState(d, 'old', 'new')
    expect(d.pendingTitles.rebind).toHaveBeenCalledWith('old', 'new')
    expect(d.sessionSetup.rebind).toHaveBeenCalledWith('old', 'new')
  })

  it('drops the pending rename and the Context setup of a removed card', () => {
    const d = deps()
    dropCardState(d, 'gone')
    expect(d.pendingTitles.forget).toHaveBeenCalledWith('gone')
    expect(d.sessionSetup.forget).toHaveBeenCalledWith('gone')
  })
})
