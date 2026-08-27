// Story 1.2 — pure status→column classifier tests (main-unit / node project).
//
// D1 (CORRECTED 2026-06-18 — the prior inverted mapping is SUPERSEDED; authoritative
// source c9watch-0.8.1-contract.md §4.3):
//   `Working`                           → `working`   (`Connecting` → `idle`: fresh spawn)
//   `NeedsAttention`/`NeedsPermission`  → `needs-you`
//   `WaitingForInput`                   → `idle`   (a LIVE column — the IDLE bucket)
//   unknown / brand-new / ''            → `needs-you` (fail-toward-attention; NEVER throws)
//
// `status` is `z.string()` upstream (not enum-locked) so the classifier accepts ANY
// string and never throws. There is NO "done" column — an exited session vanishes
// (D2, handled by the tracker on removal), so the classifier only ever returns a
// LIVE column. [Source: story 1.2 Task 1/Task 5; D1; contract §4.3]
import { describe, it, expect } from 'vitest'
import { columnForStatus, type Column } from './columns'
import { STATUS_YOUR_TURN } from '../../shared/ipc/contract'

describe('columnForStatus — pure status→live-column classifier (D1, corrected mapping)', () => {
  it('maps Working → working', () => {
    expect(columnForStatus('Working')).toBe('working')
  })

  it('maps Connecting → idle (a just-spawned session waits for the FIRST prompt — not working)', () => {
    expect(columnForStatus('Connecting')).toBe('idle')
  })

  it('maps NeedsAttention and NeedsPermission → needs-you', () => {
    expect(columnForStatus('NeedsAttention')).toBe('needs-you')
    expect(columnForStatus('NeedsPermission')).toBe('needs-you')
  })

  it('maps WaitingForInput → idle (the LIVE idle column, NOT needs-you)', () => {
    // CORRECTED semantic: WaitingForInput is the calm IDLE bucket ("waiting for your
    // next prompt"), an alive session awaiting the operator — NOT a needs-you signal.
    expect(columnForStatus('WaitingForInput')).toBe('idle')
  })

  it('YourTurn classifies to needs-you (deterministic-attention floor — do not add it to IDLE_STATUSES)', () => {
    expect(columnForStatus(STATUS_YOUR_TURN)).toBe('needs-you')
  })

  it('maps an UNKNOWN/brand-new status → needs-you (fail-toward-attention, never throws)', () => {
    // status is z.string() upstream — a status we have never seen must classify,
    // not throw, and must surface (needs-you) rather than be buried in working/idle.
    expect(columnForStatus('SomeBrandNewStatusC9watchAdded')).toBe('needs-you')
    expect(columnForStatus('')).toBe('needs-you')
    // case-sensitive: only the exact enum tokens map; lowercased variants are "unknown".
    expect(columnForStatus('working')).toBe('needs-you')
    expect(columnForStatus('waitingforinput')).toBe('needs-you')
    expect(columnForStatus('connecting')).toBe('needs-you')
  })

  it('only ever returns a LIVE column (working | needs-you | idle), never throws', () => {
    const samples = [
      'Working',
      'Connecting',
      'WaitingForInput',
      'NeedsPermission',
      'NeedsAttention',
      'Whatever',
      ''
    ]
    const live: ReadonlySet<Column> = new Set<Column>(['working', 'needs-you', 'idle'])
    for (const s of samples) {
      // Call inside not.toThrow first (the "never throws" half of the assertion),
      // then capture the result OUTSIDE the closure so `col` is a real `Column` (not
      // `Column | undefined`) — no `as Column` cast laundering undefined past strict TS.
      expect(() => columnForStatus(s)).not.toThrow()
      const col = columnForStatus(s)
      expect(live.has(col)).toBe(true)
    }
  })
})
