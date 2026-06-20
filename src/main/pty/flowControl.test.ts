// Story 3.1 — renderer-ACK flow-control accounting tests (main-unit / node project).
//
// Asserts the pure backpressure logic via INJECTED pause/resume spies — NO real pty,
// NO real MessagePort (the byte path is packaged-smoke-only; ipc.md). Covers Task 3.3:
//   - backlog crossing the high-water mark calls pause() EXACTLY ONCE;
//   - drain to/below the low-water mark calls resume() EXACTLY ONCE;
//   - no pause while the backlog stays under threshold;
//   - hysteresis (HIGH > LOW) — no flap on every chunk near the boundary;
//   - the backlog never goes negative on a stray ACK.
// [Source: story 3.1 Task 3; AR-4; architecture.md:557-559]
import { describe, it, expect, vi } from 'vitest'
import { createFlowController } from './flowControl'

describe('createFlowController — pause at high water, resume at low water (AC-1)', () => {
  it('pauses EXACTLY ONCE when the backlog crosses the high-water mark', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const fc = createFlowController({ highWater: 3, lowWater: 1, pause, resume })

    fc.onSent() // 1
    fc.onSent() // 2
    expect(pause).not.toHaveBeenCalled()
    fc.onSent() // 3 — crosses high water
    expect(pause).toHaveBeenCalledTimes(1)
    expect(fc.paused).toBe(true)

    // Still over the mark — does NOT pause again (once per crossing).
    fc.onSent() // 4
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('resumes EXACTLY ONCE when the backlog drains to/below the low-water mark', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const fc = createFlowController({ highWater: 3, lowWater: 1, pause, resume })

    fc.onSent()
    fc.onSent()
    fc.onSent() // paused at 3
    expect(fc.paused).toBe(true)

    fc.onAck() // backlog 2 — still above low water
    expect(resume).not.toHaveBeenCalled()
    fc.onAck() // backlog 1 — at low water → resume
    expect(resume).toHaveBeenCalledTimes(1)
    expect(fc.paused).toBe(false)

    // Further ACKs do not resume again (already resumed).
    fc.onAck() // backlog 0
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('never pauses when the backlog stays under the threshold', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const fc = createFlowController({ highWater: 100, lowWater: 20, pause, resume })

    for (let i = 0; i < 50; i++) fc.onSent()
    expect(pause).not.toHaveBeenCalled()
    expect(fc.paused).toBe(false)
  })

  it('hysteresis: does not flap pause/resume on every chunk near the boundary', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const fc = createFlowController({ highWater: 5, lowWater: 2, pause, resume })

    for (let i = 0; i < 5; i++) fc.onSent() // pause at 5
    expect(pause).toHaveBeenCalledTimes(1)

    // Oscillate just above the low-water mark — no resume yet, and no second pause.
    fc.onAck() // 4
    fc.onSent() // 5
    fc.onAck() // 4
    expect(resume).not.toHaveBeenCalled()
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('a stray ACK with an empty backlog is ignored (backlog never negative)', () => {
    const fc = createFlowController({ highWater: 3, lowWater: 1, pause: vi.fn(), resume: vi.fn() })
    fc.onAck()
    fc.onAck()
    expect(fc.backlog).toBe(0)
    expect(fc.paused).toBe(false)
  })

  it('uses the documented defaults when no water marks are injected', () => {
    const pause = vi.fn()
    const fc = createFlowController({ pause, resume: vi.fn() })
    // Default high water is 100 — 99 chunks must NOT pause.
    for (let i = 0; i < 99; i++) fc.onSent()
    expect(pause).not.toHaveBeenCalled()
    fc.onSent() // 100 → pause
    expect(pause).toHaveBeenCalledTimes(1)
  })
})
