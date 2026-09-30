// Story 3.1 (FR-10) — terminal IPC-arg schema tests (unit / jsdom project).
//
// The cross-process terminal-lifecycle args are UNTRUSTED → the main handler does
// `Schema.parse(raw)` → THROW typed on bad input (zod-boundaries.md IPC-arg row; this closes
// the deferred PTY receive-boundary validation). Asserts:
//   - a well-formed open/resize/stop arg parses;
//   - a blank terminalId FAILS CLOSED (mirrors SessionSchema's `id` min(1));
//   - an out-of-range / non-integer resize dim FAILS CLOSED;
//   - a missing field FAILS CLOSED.
// [Source: story 3.1 Task 2.2; .claude/rules/zod-boundaries.md; src/shared/schemas/settings.ts]
import { describe, it, expect } from 'vitest'
import {
  TerminalOpenSchema,
  TerminalResizeSchema,
  TerminalStopSchema,
  TerminalExitSchema,
  ShellOpenSchema,
  TerminalPortRendererMessageSchema,
  TERMINAL_MIN_DIM,
  TERMINAL_MAX_DIM
} from './terminal'

describe('TerminalOpenSchema — { terminalId, openToken } (parse-and-throw)', () => {
  it('parses a well-formed open arg', () => {
    expect(TerminalOpenSchema.parse({ terminalId: 'host-term-0', openToken: 'open-1' })).toEqual({
      terminalId: 'host-term-0',
      openToken: 'open-1'
    })
  })

  it('a BLANK terminalId fails closed (mirrors SessionSchema id)', () => {
    expect(() => TerminalOpenSchema.parse({ terminalId: '', openToken: 'open-1' })).toThrow()
  })

  it('a missing terminalId fails closed', () => {
    expect(() => TerminalOpenSchema.parse({ openToken: 'open-1' })).toThrow()
  })

  it('a non-string terminalId fails closed', () => {
    expect(() => TerminalOpenSchema.parse({ terminalId: 42, openToken: 'open-1' })).toThrow()
  })

  // Story 5.4 — the per-open token is REQUIRED (the renderer always sends one). A missing or blank
  // token fails closed so a malformed open can never bypass the port-disambiguation match.
  it('a missing openToken fails closed (Story 5.4)', () => {
    expect(() => TerminalOpenSchema.parse({ terminalId: 'host-term-0' })).toThrow()
  })

  it('a BLANK openToken fails closed (Story 5.4)', () => {
    expect(() => TerminalOpenSchema.parse({ terminalId: 'host-term-0', openToken: '' })).toThrow()
  })
})

describe('TerminalResizeSchema — { terminalId, cols, rows } (parse-and-throw)', () => {
  it('parses a well-formed resize arg', () => {
    expect(TerminalResizeSchema.parse({ terminalId: 't', cols: 120, rows: 40 })).toEqual({
      terminalId: 't',
      cols: 120,
      rows: 40
    })
  })

  it('accepts the boundary dims (MIN and MAX)', () => {
    expect(() =>
      TerminalResizeSchema.parse({
        terminalId: 't',
        cols: TERMINAL_MIN_DIM,
        rows: TERMINAL_MIN_DIM
      })
    ).not.toThrow()
    expect(() =>
      TerminalResizeSchema.parse({
        terminalId: 't',
        cols: TERMINAL_MAX_DIM,
        rows: TERMINAL_MAX_DIM
      })
    ).not.toThrow()
  })

  it('a zero / negative / over-max dim FAILS CLOSED', () => {
    expect(() => TerminalResizeSchema.parse({ terminalId: 't', cols: 0, rows: 24 })).toThrow()
    expect(() => TerminalResizeSchema.parse({ terminalId: 't', cols: 80, rows: -1 })).toThrow()
    expect(() =>
      TerminalResizeSchema.parse({ terminalId: 't', cols: TERMINAL_MAX_DIM + 1, rows: 24 })
    ).toThrow()
  })

  it('a non-integer dim FAILS CLOSED', () => {
    expect(() => TerminalResizeSchema.parse({ terminalId: 't', cols: 80.5, rows: 24 })).toThrow()
  })
})

describe('TerminalStopSchema / TerminalExitSchema', () => {
  it('stop parses { terminalId }; a blank id fails closed', () => {
    expect(TerminalStopSchema.parse({ terminalId: 't' })).toEqual({ terminalId: 't' })
    expect(() => TerminalStopSchema.parse({ terminalId: '' })).toThrow()
  })

  it('exit (validate-at-source) parses { terminalId, exitCode }; a non-integer code fails closed', () => {
    expect(TerminalExitSchema.parse({ terminalId: 't', exitCode: 0 })).toEqual({
      terminalId: 't',
      exitCode: 0
    })
    expect(TerminalExitSchema.parse({ terminalId: 't', exitCode: 137 }).exitCode).toBe(137)
    expect(() => TerminalExitSchema.parse({ terminalId: 't', exitCode: 1.5 })).toThrow()
    // UX-10 — an optional signal (≥ 1), an integer like the code.
    expect(TerminalExitSchema.parse({ terminalId: 't', exitCode: 0, signal: 9 }).signal).toBe(9)
    expect(() => TerminalExitSchema.parse({ terminalId: 't', exitCode: 0, signal: 0 })).toThrow()
    expect(() => TerminalExitSchema.parse({ terminalId: 't', exitCode: 0, signal: 1.5 })).toThrow()
  })
})

describe('TerminalPortRendererMessageSchema — the UNTRUSTED port byte-protocol (code-review M-1)', () => {
  it('parses a well-formed input + ack', () => {
    expect(TerminalPortRendererMessageSchema.parse({ type: 'input', data: 'ls\n' })).toEqual({
      type: 'input',
      data: 'ls\n'
    })
    expect(TerminalPortRendererMessageSchema.parse({ type: 'ack' })).toEqual({ type: 'ack' })
  })

  it('an unknown type FAILS CLOSED (no silent fall-through to ack)', () => {
    expect(() => TerminalPortRendererMessageSchema.parse({ type: 'bogus' })).toThrow()
  })

  it('an input missing its data FAILS CLOSED', () => {
    expect(() => TerminalPortRendererMessageSchema.parse({ type: 'input' })).toThrow()
  })

  it('a non-string input data FAILS CLOSED', () => {
    expect(() => TerminalPortRendererMessageSchema.parse({ type: 'input', data: 42 })).toThrow()
  })
})

describe('ShellOpenSchema — the shell:open arg (fail-closed, strict)', () => {
  it('accepts a non-empty parentTerminalId', () => {
    expect(ShellOpenSchema.parse({ parentTerminalId: 'launch-1' })).toEqual({
      parentTerminalId: 'launch-1'
    })
  })
  it('rejects a blank id, a missing id, and an unknown key', () => {
    expect(ShellOpenSchema.safeParse({ parentTerminalId: '' }).success).toBe(false)
    expect(ShellOpenSchema.safeParse({}).success).toBe(false)
    expect(ShellOpenSchema.safeParse({ parentTerminalId: 'x', cwd: '/tmp' }).success).toBe(false)
  })
})
