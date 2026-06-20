// Story 3.1 (FR-10) — the terminal-host URL-hash gate tests (unit / jsdom project).
//
// Pure parser: `#terminals` → 1; `#terminals=N` → N (clamped to [1,64] for the NFR-5 manual
// many-terminals check); anything else → 0 (not the terminal host). Gating the host on the
// hash keeps the default board view + the Story-0.1 smoke path untouched. [Source: story 3.1 Task 5]
import { describe, it, expect } from 'vitest'
import { parseTerminalHostCount } from './terminalHostHash'

describe('parseTerminalHostCount — the embedded-terminal host gate', () => {
  it('#terminals mounts exactly one terminal', () => {
    expect(parseTerminalHostCount('#terminals')).toBe(1)
  })

  it('#terminals=N mounts N terminals (the NFR-5 many-terminals check)', () => {
    expect(parseTerminalHostCount('#terminals=12')).toBe(12)
    expect(parseTerminalHostCount('#terminals=1')).toBe(1)
  })

  it('clamps a runaway count to the upper guard (no flood)', () => {
    expect(parseTerminalHostCount('#terminals=9999')).toBe(64)
  })

  it('returns 0 for a non-terminal hash (default board view)', () => {
    expect(parseTerminalHostCount('')).toBe(0)
    expect(parseTerminalHostCount('#board')).toBe(0)
    expect(parseTerminalHostCount('#terminalsX')).toBe(0)
    expect(parseTerminalHostCount('#terminals=')).toBe(0)
    expect(parseTerminalHostCount('#terminals=0')).toBe(0)
    expect(parseTerminalHostCount('#terminals=-3')).toBe(0)
  })
})
