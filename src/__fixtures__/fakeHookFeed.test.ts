// Story 6.4 — the FAIL-CLOSED hook-feed replay test (the load-bearing fixture test).
//
// Ported from the retired fakeC9watchFeed.test.ts: exercises the ONE external Zod
// boundary of the native session engine — `HookEventSchema`
// (src/shared/schemas/hookEvent.ts) — by replaying the fake hook POST bodies through
// a small in-test "ingest loop" (a stand-in for hookServer.ts's body → JSON →
// schema → onHookEvent path) and asserting the fail-closed contract:
//
//   - the ONE malformed body is DROPPED (it never reaches a consumer, never throws
//     out of the loop),
//   - a log collector is called EXACTLY ONCE, with the error PATH + CODE only —
//     NEVER the raw body (Critical Guardrail #6: hook payloads carry
//     prompt/tool_input/last_assistant_message = secrets; a ZodError stringifies
//     its input),
//   - every VALID body parses and carries the fields the hookStatus mapper reads
//     (one bad POST does not poison the good ones),
//   - no crash.
import { describe, it, expect, vi } from 'vitest'
import { HookEventSchema, type HookEvent } from '../shared/schemas/hookEvent'
import {
  fakeHookBodies,
  MALFORMED_BODY_INDEX,
  VALID_HOOK_BODY_COUNT,
  HOOK_FIXTURE_VERSION,
  FAKE_HOOK_SESSION_ID,
  fakeUserPromptSubmitBody,
  fakeStopBodyNoTitle
} from './fakeHookFeed'
import { titleReadBackRename } from '../main/hooks/titleReadBack'

/** A single error record — PATH + CODE only, NEVER the parsed/raw value. */
interface BoundaryErrorRecord {
  /** Where the failure happened (Zod issue path joined by '.', or a marker). */
  path: string
  /** The Zod issue code (e.g. 'invalid_type') OR 'invalid_json' for non-JSON. */
  code: string
}

/**
 * The in-test "ingest loop" — a stand-in for the hookServer body path. Folds raw
 * POST bodies into the list of validated events, dropping + logging (by path+code
 * only) any body that is not valid JSON or fails the schema. FAIL-CLOSED, never
 * throws. Mirrors hookServer.ts: JSON boundary first (value-free), then the ONE
 * `HookEventSchema` boundary.
 */
function ingestBodies(
  bodies: readonly string[],
  log: (err: BoundaryErrorRecord) => void
): HookEvent[] {
  const events: HookEvent[] = []
  for (const body of bodies) {
    // 1) JSON boundary — a corrupt/truncated body is dropped + logged by marker.
    //    NEVER log `body` (a V8 SyntaxError message can EMBED a window of the input).
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      log({ path: '(body)', code: 'invalid_json' })
      continue
    }
    // 2) Schema boundary — the real fail-closed adapter.
    const result = HookEventSchema.safeParse(parsed)
    if (!result.success) {
      const issue = result.error.issues[0]
      log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
      continue
    }
    events.push(result.data)
  }
  return events
}

describe('fail-closed hook-feed replay against the real HookEventSchema boundary', () => {
  it('the fixture is schema-versioned (drift is a one-line bump)', () => {
    expect(HOOK_FIXTURE_VERSION).toBe('2.1.199')
  })

  it('drops the one malformed body, logs once by path+code, keeps the valid ones, no crash', () => {
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()

    // The fixture has exactly one malformed body, interleaved between good ones.
    expect(typeof fakeHookBodies[MALFORMED_BODY_INDEX]).toBe('string')

    let events: HookEvent[] = []
    expect(() => {
      events = ingestBodies(fakeHookBodies, log)
    }).not.toThrow() // no crash

    // The malformed body was dropped → log called EXACTLY once.
    expect(log).toHaveBeenCalledTimes(1)

    // It logged PATH + CODE only — and the raw malformed body never leaked.
    const logged = log.mock.calls[0]?.[0]
    expect(logged).toBeDefined()
    expect(typeof logged?.path).toBe('string')
    expect(typeof logged?.code).toBe('string')
    // STRUCTURAL guarantee (stronger than substring-scanning): the record carries
    // ONLY {path, code} — no field that could carry the raw body/parsed value.
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    const serialized = JSON.stringify(log.mock.calls)
    expect(serialized).not.toContain('bbbbbbbb-2222-4222-8222') // the raw bad-body fragment

    // Every valid body survived (fail-closed: one bad POST does not poison the rest)…
    expect(events).toHaveLength(VALID_HOOK_BODY_COUNT)
    // …and each carries the identity + event name the ingest keys on.
    for (const evt of events) {
      expect(evt.session_id).toBe(FAKE_HOOK_SESSION_ID)
      expect(typeof evt.hook_event_name).toBe('string')
    }
  })

  it('the valid bodies carry the exact fields the hookStatus mapper discriminates on', () => {
    const events = ingestBodies(fakeHookBodies, () => {})
    const names = events.map((e) => e.hook_event_name)
    expect(names).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'Notification',
      'Stop',
      'Stop',
      'SessionEnd'
    ])
    // The needs-you discriminators are TYPED optionals on the schema (Phase 2) —
    // present + string-typed on the parsed events, absent elsewhere.
    expect(events[1]?.tool_name).toBe('AskUserQuestion')
    expect(events[2]?.notification_type).toBe('permission_prompt')
    expect(events[3]?.last_assistant_message?.endsWith('?')).toBe(true)
    expect(events[4]?.last_assistant_message?.endsWith('?')).toBe(false)
    expect(events[0]?.tool_name).toBeUndefined()
  })

  it('passthrough absorbs the sensitive extras without validating them', () => {
    // prompt / tool_input / message / reason ride `.passthrough()` — they must
    // survive the parse (fail-OPEN on additions) but are NEVER declared or logged.
    const events = ingestBodies(fakeHookBodies, () => {})
    const prompt = (events[0] as Record<string, unknown>)['prompt']
    expect(typeof prompt).toBe('string')
    const toolInput = (events[1] as Record<string, unknown>)['tool_input']
    expect(typeof toolInput).toBe('object')
  })

  it('a schema-invalid body (blank session_id) also fails closed by path+code, never the value', () => {
    const SECRET = 'the-secret-assistant-prose'
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    const events = ingestBodies(
      [JSON.stringify({ session_id: '', hook_event_name: 'Stop', last_assistant_message: SECRET })],
      log
    )
    expect(events).toHaveLength(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]?.path).toBe('session_id')
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
  })
})

// Name-sync — the boundary must accept the shape claude 2.1.243 ACTUALLY sends, including
// fields that did not exist at 2.1.199. Hand-written payloads can drift from reality without
// anyone noticing; these key sets came off a live probe.
describe('observed claude 2.1.243 payloads (name-sync)', () => {
  it('accepts the real UserPromptSubmit shape and exposes session_title', () => {
    const result = HookEventSchema.safeParse(JSON.parse(fakeUserPromptSubmitBody))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.session_title).toBe('billing api')
    // New-since-2.1.199 keys must survive passthrough rather than fail the event closed.
    const raw = result.data as Record<string, unknown>
    expect(raw.permission_mode).toBe('default')
    expect(raw.prompt_id).toBe('bbbbbbbb-2222-4222-8222-222222222222')
  })

  it('accepts the real Stop shape, which carries NO session_title', () => {
    const result = HookEventSchema.safeParse(JSON.parse(fakeStopBodyNoTitle))

    expect(result.success).toBe(true)
    if (!result.success) return
    // Making session_title required would fail-close every Stop and kill idle tracking.
    expect(result.data.session_title).toBeUndefined()
    expect(result.data.last_assistant_message).toBeDefined()
  })

  it('the read-back ignores a Stop and acts on a UserPromptSubmit', () => {
    const stop = HookEventSchema.parse(JSON.parse(fakeStopBodyNoTitle))
    const submit = HookEventSchema.parse(JSON.parse(fakeUserPromptSubmitBody))

    expect(titleReadBackRename(stop, 'old name', false)).toBeNull()
    expect(titleReadBackRename(submit, 'old name', false)).toBe('billing api')
  })
})
