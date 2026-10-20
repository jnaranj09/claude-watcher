// The `/mod/report` boundary (spec 2026-10-18 §2): strict, fail closed. The builder side of the
// same shape is pinned in tests/unit/bridgeModReport.test.ts (its output parses here).
import { describe, it, expect } from 'vitest'
import { ModReportSchema } from './modReport'
import { modReportFixture } from '../../__fixtures__/modReport'

describe('ModReportSchema', () => {
  it('parses a full report', () => {
    expect(ModReportSchema.safeParse(modReportFixture()).success).toBe(true)
  })

  it('parses null skills and null commands', () => {
    expect(
      ModReportSchema.safeParse(modReportFixture({ skills: null, slashCommands: null })).success
    ).toBe(true)
  })

  it('takes any kind claude sends, not a fixed list', () => {
    const r = modReportFixture({ instructionFiles: [{ path: '/a', kind: 'someNewTier' }] })
    expect(ModReportSchema.safeParse(r).success).toBe(true)
  })

  it('fails an extra key at the top', () => {
    expect(ModReportSchema.safeParse({ ...modReportFixture(), env: { A: '1' } }).success).toBe(
      false
    )
  })

  it('fails an extra key inside a row', () => {
    const r = modReportFixture()
    const bad = { ...r, instructionFiles: [{ path: '/a', kind: 'user', content: 'x' }] }
    expect(ModReportSchema.safeParse(bad).success).toBe(false)
  })

  it('fails version 2', () => {
    expect(ModReportSchema.safeParse({ ...modReportFixture(), version: 2 }).success).toBe(false)
  })

  it('fails a blank session id', () => {
    expect(ModReportSchema.safeParse(modReportFixture({ sessionId: '' })).success).toBe(false)
  })
})
