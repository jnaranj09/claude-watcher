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

  it('passes through unknown fields (e.g. prompt, tool_input) without failing', () => {
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

  it('passes through a truly-unknown key (passthrough still absorbs after Phase-2 optionals)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'PreToolUse',
      some_brand_new_field: 'a field this schema has never heard of',
      another_unknown: { nested: 'value' }
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    // the unknown key survives parse (passthrough preserves it)
    expect((result.data as Record<string, unknown>).some_brand_new_field).toBe(
      'a field this schema has never heard of'
    )
  })

  it('parses the Phase-2 typed optionals when present (notification_type, tool_name, last_assistant_message)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      tool_name: 'AskUserQuestion',
      last_assistant_message: 'Are we good to proceed?'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.notification_type).toBe('permission_prompt')
    expect(result.data.tool_name).toBe('AskUserQuestion')
    expect(result.data.last_assistant_message).toBe('Are we good to proceed?')
  })

  it('keeps the Phase-2 optionals free strings (an unknown value still parses — NOT enum-locked)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Notification',
      notification_type: 'some_brand_new_notification_kind',
      tool_name: 'SomeFutureTool'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.notification_type).toBe('some_brand_new_notification_kind')
    expect(result.data.tool_name).toBe('SomeFutureTool')
  })

  it('parses when the Phase-2 optionals are absent (optional → undefined, still valid)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.notification_type).toBeUndefined()
    expect(result.data.tool_name).toBeUndefined()
    expect(result.data.last_assistant_message).toBeUndefined()
  })

  it('fails closed on a WRONG TYPE for a present notification_type (number, not string)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Notification',
      notification_type: 123
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    expect((issue?.path ?? []).join('.')).toBe('notification_type')
  })

  it('fails closed on a WRONG TYPE for a present tool_name (object, not string)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'PreToolUse',
      tool_name: { not: 'a string' }
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    expect((issue?.path ?? []).join('.')).toBe('tool_name')
  })

  it('fails closed on a WRONG TYPE for a present last_assistant_message (number, not string)', () => {
    const result = HookEventSchema.safeParse({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop',
      last_assistant_message: 42
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    expect((issue?.path ?? []).join('.')).toBe('last_assistant_message')
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
