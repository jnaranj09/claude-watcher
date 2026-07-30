// Story 3.2 (FR-11) — the launch-arg schema fail-closed gate.
//
// The `session:launch` arg is UNTRUSTED cross-process input → parse-and-throw at the main
// boundary. These assert the our-shape fail-closed posture (NO `.passthrough()`): a valid
// `{ cwd }` parses; a blank/non-string/missing cwd fails closed. The never-log-the-value rule
// is enforced at the CALL SITE (the handler logs path/code only) — the schema just throws.
import { describe, it, expect } from 'vitest'
import {
  SessionLaunchSchema,
  SessionNameSchema,
  SessionRenameSchema,
  SESSION_NAME_MAX_LENGTH,
  LaunchCorrelatedSchema
} from './launch'
import { CH } from '../ipc/contract'
import type { LaunchCorrelatedEvent } from '../ipc/contract'

/** A valid arg — the per-test overrides below mutate ONE field so each case is about that field. */
const VALID = { cwd: '/home/op/project', name: 'project' }

describe('SessionLaunchSchema — the launch-arg fail-closed boundary (AC-6)', () => {
  it('accepts a valid non-empty cwd', () => {
    const r = SessionLaunchSchema.safeParse(VALID)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cwd).toBe('/home/op/project')
  })

  it('FAILS CLOSED on a blank cwd (mirrors SessionSchema.id / TerminalIdSchema)', () => {
    expect(SessionLaunchSchema.safeParse({ ...VALID, cwd: '' }).success).toBe(false)
  })

  it('FAILS CLOSED on a non-string cwd', () => {
    expect(SessionLaunchSchema.safeParse({ ...VALID, cwd: 42 }).success).toBe(false)
    expect(SessionLaunchSchema.safeParse({ ...VALID, cwd: null }).success).toBe(false)
  })

  it('FAILS CLOSED on a missing cwd', () => {
    expect(SessionLaunchSchema.safeParse({ name: 'project' }).success).toBe(false)
  })

  it('THROWS (parse, not safeParse) on bad input so the handler rejects the invoke', () => {
    expect(() => SessionLaunchSchema.parse({ ...VALID, cwd: '' })).toThrow()
  })

  it('the parse error reports a PATH + CODE and does not require echoing the value', () => {
    const r = SessionLaunchSchema.safeParse({ ...VALID, cwd: 5 })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path.join('.')).toBe('cwd')
      expect(typeof issue?.code).toBe('string')
    }
  })
})

// Session-naming — the operator-typed name is the SECOND untrusted field on the same arg. These
// pin the I/O matrix rows: a blank/whitespace-only/over-long/missing/non-string name must fail
// closed (nothing spawns), and a padded name must be stored trimmed.
describe('SessionNameSchema — the operator-typed session name', () => {
  it('accepts an ordinary name', () => {
    const r = SessionNameSchema.safeParse('billing api')
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe('billing api')
  })

  it('TRIMS before storing, so the card shows the tidy name', () => {
    const r = SessionNameSchema.safeParse('  api  ')
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe('api')
  })

  it('FAILS CLOSED on a blank name', () => {
    expect(SessionNameSchema.safeParse('').success).toBe(false)
  })

  it('FAILS CLOSED on a WHITESPACE-ONLY name (trim runs BEFORE the length check, so this is not stored as blank)', () => {
    expect(SessionNameSchema.safeParse('   ').success).toBe(false)
  })

  it('accepts exactly SESSION_NAME_MAX_LENGTH and fails one char over', () => {
    expect(SessionNameSchema.safeParse('x'.repeat(SESSION_NAME_MAX_LENGTH)).success).toBe(true)
    expect(SessionNameSchema.safeParse('x'.repeat(SESSION_NAME_MAX_LENGTH + 1)).success).toBe(false)
  })

  it('measures the length AFTER trimming (padding does not count toward the max)', () => {
    const padded = `  ${'x'.repeat(SESSION_NAME_MAX_LENGTH)}  `
    expect(SessionNameSchema.safeParse(padded).success).toBe(true)
  })

  it('FAILS CLOSED on a non-string name', () => {
    expect(SessionNameSchema.safeParse(42).success).toBe(false)
    expect(SessionNameSchema.safeParse(null).success).toBe(false)
  })

  // `sessionName` is rendered on the board card, the rail row, the Stop-confirm title and the OS
  // notification title — all single-line surfaces. `trim()` only strips the EDGES, so an interior
  // control character would survive. A text input cannot produce these, but this schema is the
  // boundary for an UNTRUSTED renderer and must not depend on the widget.
  it('FAILS CLOSED on interior control characters', () => {
    expect(SessionNameSchema.safeParse('api\nprod').success).toBe(false) // newline
    expect(SessionNameSchema.safeParse('api\tprod').success).toBe(false) // tab
    expect(SessionNameSchema.safeParse('api\u001b[2Jprod').success).toBe(false) // ANSI escape
    expect(SessionNameSchema.safeParse('api\u0000prod').success).toBe(false) // NUL
    expect(SessionNameSchema.safeParse('api\u007fprod').success).toBe(false) // DEL
  })

  it('still accepts ordinary international text and emoji (the guard is control chars ONLY)', () => {
    for (const name of ['apí ñ', '日本語セッション', 'billing 🚀', 'api-v2_rewrite (wip)']) {
      expect(SessionNameSchema.safeParse(name).success, name).toBe(true)
    }
  })
})

describe('SessionLaunchSchema — the name field on the launch arg', () => {
  it('FAILS CLOSED on a missing name (a launch without one never spawns)', () => {
    expect(SessionLaunchSchema.safeParse({ cwd: '/home/op/project' }).success).toBe(false)
  })

  it('FAILS CLOSED on a whitespace-only name, and reports PATH=name + a CODE', () => {
    const r = SessionLaunchSchema.safeParse({ ...VALID, name: '   ' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path.join('.')).toBe('name')
      expect(typeof issue?.code).toBe('string')
    }
  })

  it('FAILS CLOSED on an over-long name (the I/O-matrix 400-char row)', () => {
    expect(SessionLaunchSchema.safeParse({ ...VALID, name: 'x'.repeat(400) }).success).toBe(false)
  })

  it('returns the TRIMMED name alongside the cwd', () => {
    const r = SessionLaunchSchema.safeParse({ ...VALID, name: '  billing api  ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.name).toBe('billing api')
      expect(r.data.cwd).toBe('/home/op/project')
    }
  })
})

describe('Story 3.4 — CH.launchCorrelated channel + LaunchCorrelatedSchema (validate-at-source)', () => {
  it('the channel name is the lowercase domain:action const (no string literal)', () => {
    expect(CH.launchCorrelated).toBe('launch:correlated')
  })

  it('accepts a valid { terminalId, sessionId } binding', () => {
    const binding: LaunchCorrelatedEvent = {
      terminalId: 'launch-abc',
      sessionId: 'sess-uuid-1'
    }
    const r = LaunchCorrelatedSchema.safeParse(binding)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.terminalId).toBe('launch-abc')
      expect(r.data.sessionId).toBe('sess-uuid-1')
    }
  })

  it('FAILS CLOSED on a blank terminalId (the boundary never ships a half-formed binding)', () => {
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: '', sessionId: 's' }).success).toBe(false)
  })

  it('FAILS CLOSED on a blank sessionId', () => {
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: 't', sessionId: '' }).success).toBe(false)
  })

  it('FAILS CLOSED on non-string / missing fields (our shape, no passthrough)', () => {
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: 1, sessionId: 's' }).success).toBe(false)
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: 't' }).success).toBe(false)
    expect(LaunchCorrelatedSchema.safeParse(null).success).toBe(false)
  })

  it('reports a PATH + CODE on a parse miss (never requires echoing the value)', () => {
    const r = LaunchCorrelatedSchema.safeParse({ terminalId: '', sessionId: 's' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path.join('.')).toBe('terminalId')
      expect(typeof issue?.code).toBe('string')
    }
  })
})

// Session-naming A2 — the `session:rename` arg boundary. Same our-shape fail-closed posture as the
// launch arg, and it REUSES SessionNameSchema so both paths agree on a legal name by construction.
describe('SessionRenameSchema — the rename-arg fail-closed boundary', () => {
  const VALID_RENAME = { id: 'launch01-0000-4000-8000-000000000001', name: 'deploy-prod' }

  it('parses a valid { id, name }', () => {
    const r = SessionRenameSchema.safeParse(VALID_RENAME)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual(VALID_RENAME)
  })

  it('FAILS CLOSED on a blank id', () => {
    expect(SessionRenameSchema.safeParse({ ...VALID_RENAME, id: '' }).success).toBe(false)
  })

  it('FAILS CLOSED on a missing / non-string id', () => {
    expect(SessionRenameSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(SessionRenameSchema.safeParse({ ...VALID_RENAME, id: 42 }).success).toBe(false)
  })

  it('accepts a NON-uuid id — an unknown id must reach the reducer no-op, not throw here', () => {
    // Deliberately not `.uuid()`: existence is the reducer's call (rename_unknown_id), and a shape
    // gate that rejected non-uuids would turn a benign race into a rejected invoke.
    expect(SessionRenameSchema.safeParse({ ...VALID_RENAME, id: 'not-a-uuid' }).success).toBe(true)
  })

  it('REUSES SessionNameSchema — every name rule the create path enforces applies here', () => {
    // blank / whitespace-only / over-long / control char: the same four the create arg rejects.
    expect(SessionRenameSchema.safeParse({ ...VALID_RENAME, name: '' }).success).toBe(false)
    expect(SessionRenameSchema.safeParse({ ...VALID_RENAME, name: '   ' }).success).toBe(false)
    expect(
      SessionRenameSchema.safeParse({
        ...VALID_RENAME,
        name: 'x'.repeat(SESSION_NAME_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
    expect(SessionRenameSchema.safeParse({ ...VALID_RENAME, name: 'a\nb' }).success).toBe(false)
  })

  it('TRIMS the name, exactly like the create path', () => {
    const r = SessionRenameSchema.safeParse({ ...VALID_RENAME, name: '  padded  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.name).toBe('padded')
  })

  it('FAILS CLOSED on an unknown extra key (our shape — no passthrough)', () => {
    // NOTE: zod objects strip unknown keys by default rather than erroring, so what this pins is
    // that no extra key can SURVIVE into the parsed arg the handler acts on.
    const r = SessionRenameSchema.safeParse({ ...VALID_RENAME, cwd: '/etc' })
    expect(r.success).toBe(true)
    if (r.success) expect('cwd' in r.data).toBe(false)
  })

  it('reports a PATH + CODE on a parse miss (never requires echoing the value)', () => {
    const r = SessionRenameSchema.safeParse({ id: '', name: 'ok' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path.join('.')).toBe('id')
      expect(typeof issue?.code).toBe('string')
    }
  })

  it('CH.sessionRename is the registered channel const (never a literal at a call site)', () => {
    expect(CH.sessionRename).toBe('session:rename')
  })
})
