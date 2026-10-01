// The packaged smoke's pass/fail decision (spec 2026-09-30 release pipeline, section 3).
// CI has no GPU, so `SMOKE_WEBGL=optional` turns ONLY the WebGL check into a warning.
import { describe, it, expect } from 'vitest'
import { evaluateVerdict, webglMode } from '../smoke/smokeVerdict.mjs'

const passing = (): Record<string, unknown> => ({
  pass: true,
  checks: {
    typeEcho: { pass: true },
    resize: { pass: true },
    tui: { pass: true },
    webgl: { pass: true }
  },
  main: { api: { pass: true }, themes: { pass: true } }
})

const noWebgl = (): Record<string, unknown> => {
  const r = passing()
  r.pass = false // the app's own `pass` includes WebGL
  ;(r.checks as Record<string, unknown>).webgl = { active: false, pass: false }
  return r
}

describe('webglMode', () => {
  it('is optional only for the exact value "optional"', () => {
    expect(webglMode({ SMOKE_WEBGL: 'optional' })).toBe('optional')
  })
  it.each([undefined, '', 'OPTIONAL', ' optional', '1', 'true', 'strict'])(
    'is strict for %j',
    (v) => {
      expect(webglMode({ SMOKE_WEBGL: v })).toBe('strict')
    }
  )
})

describe('evaluateVerdict', () => {
  it('passes a full report in both modes', () => {
    expect(evaluateVerdict(passing(), 'strict')).toEqual({ ok: true, warnings: [] })
    expect(evaluateVerdict(passing(), 'optional')).toEqual({ ok: true, warnings: [] })
  })

  it('fails a WebGL miss in strict mode', () => {
    expect(evaluateVerdict(noWebgl(), 'strict').ok).toBe(false)
  })

  it('passes a WebGL miss in optional mode, with a warning', () => {
    const v = evaluateVerdict(noWebgl(), 'optional')
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(1)
    expect(v.warnings[0]).toMatch(/webgl/i)
  })

  it('passes a report with no webgl check at all in optional mode, with a warning', () => {
    const r = noWebgl()
    delete (r.checks as Record<string, unknown>).webgl
    const v = evaluateVerdict(r, 'optional')
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(1)
  })

  it.each(['typeEcho', 'resize', 'tui'])('fails a %s miss in optional mode', (key) => {
    const r = noWebgl()
    ;(r.checks as Record<string, unknown>)[key] = { pass: false }
    expect(evaluateVerdict(r, 'optional').ok).toBe(false)
  })

  it.each(['api', 'themes'])('fails a main.%s miss in both modes', (key) => {
    for (const mode of ['strict', 'optional'] as const) {
      const r = mode === 'strict' ? passing() : noWebgl()
      ;(r.main as Record<string, unknown>)[key] = { pass: false }
      expect(evaluateVerdict(r, mode).ok).toBe(false)
    }
  })

  it('fails the app error path in optional mode', () => {
    const r = { pass: false, error: 'boom', checks: {} }
    expect(evaluateVerdict(r, 'optional').ok).toBe(false)
  })

  it('fails a report carrying an error even if every check passed', () => {
    const r = noWebgl()
    r.error = 'late failure'
    expect(evaluateVerdict(r, 'optional').ok).toBe(false)
  })

  it('fails garbage input without throwing', () => {
    expect(evaluateVerdict(null, 'optional').ok).toBe(false)
    expect(evaluateVerdict('x', 'strict').ok).toBe(false)
  })
})
