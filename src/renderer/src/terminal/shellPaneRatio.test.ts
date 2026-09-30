import { describe, it, expect } from 'vitest'
import {
  clampShellRatio,
  ratioFromPointer,
  shellPercent,
  stepShellRatio,
  SHELL_PANE_MIN_PX,
  SHELL_DIVIDER_PX
} from './shellPaneRatio'

describe('clampShellRatio — the 0.15–0.85 band AND 80px per side', () => {
  it('keeps a value inside both limits', () => {
    expect(clampShellRatio(0.3, 800)).toBe(0.3)
  })
  it('clamps to the band when the frame is tall (80px is smaller than 15%)', () => {
    expect(clampShellRatio(0.05, 1000)).toBe(0.15)
    expect(clampShellRatio(0.99, 1000)).toBe(0.85)
  })
  it('clamps to 80px per side when the frame is short (80px is larger than 15%)', () => {
    // 400px: 80/400 = 0.2 > 0.15, so the shell can be no smaller than 0.2. Claude keeps 80px AND
    // the divider's 14px sit between them, so the shell can be no larger than (400-94)/400.
    expect(clampShellRatio(0.1, 400)).toBeCloseTo(0.2, 10)
    expect(clampShellRatio(0.95, 400)).toBeCloseTo(0.765, 10)
    expect(SHELL_DIVIDER_PX).toBe(14)
    expect(SHELL_PANE_MIN_PX).toBe(80)
  })
  it('a frame under 160px falls back to the ratio band (the two 80px minimums cannot both hold)', () => {
    expect(clampShellRatio(0.5, 100)).toBe(0.5)
    expect(clampShellRatio(0.05, 100)).toBe(0.15)
    expect(clampShellRatio(0.95, 100)).toBe(0.85)
    expect(Number.isNaN(clampShellRatio(0.5, 0))).toBe(false)
  })
})

describe('ratioFromPointer — the shell share from a pointer y', () => {
  it('is the distance from the pointer to the bottom over the height', () => {
    expect(ratioFromPointer(700, { top: 100, height: 800 })).toBeCloseTo(0.25, 10)
    expect(ratioFromPointer(100, { top: 100, height: 800 })).toBe(1)
    expect(ratioFromPointer(900, { top: 100, height: 800 })).toBe(0)
  })
})

describe('stepShellRatio — ArrowUp grows the shell 5%, ArrowDown shrinks it, clamped', () => {
  it('steps by 0.05', () => {
    expect(stepShellRatio(0.3, 'ArrowUp', 1000)).toBeCloseTo(0.35, 10)
    expect(stepShellRatio(0.3, 'ArrowDown', 1000)).toBeCloseTo(0.25, 10)
  })
  it('stops at the clamp', () => {
    expect(stepShellRatio(0.84, 'ArrowUp', 1000)).toBe(0.85)
    expect(stepShellRatio(0.16, 'ArrowDown', 1000)).toBe(0.15)
  })
})

describe('shellPercent', () => {
  it('rounds to an integer for aria-valuenow', () => {
    expect(shellPercent(0.3)).toBe(30)
    expect(shellPercent(0.333)).toBe(33)
  })
})
