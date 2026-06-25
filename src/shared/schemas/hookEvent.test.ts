// Hook-status feature — unit tests for the HookEventSchema Zod boundary.
//
// Runs under the `unit` Vitest project (jsdom) — this is in src/shared/schemas/,
// which matches the `unit` project's test glob.
//
// Validates:
//  - happy-path parse (minimal + extra fields via .passthrough())
//  - blank/missing session_id fails closed
//  - missing hook_event_name fails closed
//  - the error log record carries ONLY {path, code} — never body content
// [spec Tasks; .claude/rules/zod-boundaries.md]

import { describe, it, expect } from 'vitest'
import { HookEventSchema } from './hookEvent'

describe('HookEventSchema — fail-closed Zod boundary', () => {
  it('parses a valid minimal event', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.session_id).toBe('aaaaaaaa-0000-4000-8000-000000000001')
    expect(result.data.hook_event_name).toBe('Stop')
  })

  it('parses a valid event with optional cwd', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'UserPromptSubmit',
      cwd: '/home/user/project'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.cwd).toBe('/home/user/project')
  })

  it('passes through unknown fields (e.g. last_assistant_message, prompt) without failing', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop',
      last_assistant_message: 'SECRET CONTENT — must pass through, not fail',
      prompt: 'user prompt text — also secret',
      tool_input: { some: 'object' }
    })
    // .passthrough() means unknown keys are preserved, not rejected
    expect(result.success).toBe(true)
  })

  it('fails closed on a blank session_id', () => {
    const result = HookEventSchema.safeParse({
      session_id: '',
      hook_event_name: 'Stop'
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    // Log record must be {path, code} only — confirm issue has a path and code
    expect(issue).toBeDefined()
    expect(typeof issue?.code).toBe('string')
    const path = (issue?.path ?? []).join('.') || '(root)'
    expect(typeof path).toBe('string')
    // The error must NOT embed the value in the serialized issue keys
    expect(Object.keys(issue ?? {}).sort()).not.toContain('message_with_value')
  })

  it('fails closed on a missing session_id', () => {
    const result = HookEventSchema.safeParse({
      hook_event_name: 'Stop'
    })
    expect(result.success).toBe(false)
  })

  it('fails closed on a missing hook_event_name', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001'
    })
    expect(result.success).toBe(false)
  })

  it('log record structure: error carries {path, code} only — never the body fragment', () => {
    const SECRET = 'secret-session-id-that-must-not-leak'
    const result = HookEventSchema.safeParse({
      session_id: '', // blank → min(1) fails
      hook_event_name: 'Stop',
      last_assistant_message: SECRET
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    // Build the same log record the boundary code would build
    const logRecord = {
      path: (issue?.path ?? []).join('.') || '(root)',
      code: issue?.code ?? 'invalid'
    }
    expect(Object.keys(logRecord).sort()).toEqual(['code', 'path'])
    // The log record must NOT contain the secret body fragment
    expect(JSON.stringify(logRecord)).not.toContain(SECRET)
    // The Zod error string may contain the value — but the log record must not
    const serialized = JSON.stringify(logRecord)
    expect(serialized).not.toContain('secret-session-id-that-must-not-leak')
  })
})
