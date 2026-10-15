// columnForStatus: the pure status -> column classifier. `main-unit` project (node).
//
//   `Working`                           -> `working`
//   `Connecting`, `WaitingForInput`     -> `idle`   (a LIVE column: waiting for the next prompt)
//   `NeedsAttention`/`NeedsPermission`  -> `needs-you`
//   `YourTurn`                          -> `needs-you`
//   unknown / brand-new / ''            -> `needs-you` (fail-toward-attention; NEVER throws)
//
// `status` is `z.string()` upstream (not enum-locked), so the classifier accepts ANY string and
// never throws. There is no "done" column: an exited session is removed by the reducer, so the
// classifier only ever returns a LIVE column.
import { describe, it, expect } from 'vitest'
import { columnForStatus, type Column } from './columns'
import { STATUS_YOUR_TURN } from '../../shared/ipc/contract'

describe('columnForStatus — pure status→live-column classifier (working, idle, needs-you)', () => {
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
    expect(columnForStatus('SomeBrandNewStatus')).toBe('needs-you')
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
