// Programmatic API — the shared request/response schemas (Task 9).
//
// These schemas are the API's ONE shape gate: main parses every request (params/query/body)
// and validates every response AT SOURCE before writing it, and the OpenAPI document is
// generated from the same objects. The two properties that matter here are (1) STRICTNESS —
// `.strict()` everywhere, so an unknown key is a 400 rather than a silent pass-through, and
// (2) the session projection is STATE ONLY: no prompt, no assistant prose, no tool INPUT can
// reach the wire even if a caller hands one in.
//
// never-log-the-parsed-value still applies to every consumer of these schemas: a ZodError
// stringifies its input, and a create body carries an operator-typed name. Callers log the
// issue PATH + CODE only. [.claude/rules/zod-boundaries.md]
import { describe, it, expect } from 'vitest'
import {
  API_ERROR_CODES,
  ApiErrorBodySchema,
  ApiSessionListSchema,
  ApiSessionSchema,
  ApiTemplateListSchema,
  ApiTemplateSchema,
  ApiWorkspaceListSchema,
  ApiWorkspaceSchema,
  EmptySchema,
  SessionIdParamsSchema,
  SessionsCreateBodySchema,
  SessionsCreateOutputSchema,
  SessionsListQuerySchema,
  TemplatesListQuerySchema
} from './api'
import { COLUMNS } from '../ipc/contract'

const SESSION = {
  id: 's1',
  sessionName: 'HT-1',
  status: 'Working',
  column: COLUMNS[0],
  enteredColumnAt: 1,
  workspaceId: 'default',
  tagIds: [],
  projectPath: '/w'
}

describe('ApiSessionSchema', () => {
  it('accepts the state projection, with pendingToolName optional', () => {
    expect(ApiSessionSchema.parse(SESSION)).toEqual(SESSION)
    expect(ApiSessionSchema.parse({ ...SESSION, pendingToolName: 'Bash' }).pendingToolName).toBe(
      'Bash'
    )
  })
  it('is strict: content fields never leak through', () => {
    expect(ApiSessionSchema.safeParse({ ...SESSION, latestMessage: 'x' }).success).toBe(false)
    expect(ApiSessionSchema.safeParse({ ...SESSION, pendingToolInput: 'x' }).success).toBe(false)
  })
  it('column is one of the board columns', () => {
    expect(ApiSessionSchema.safeParse({ ...SESSION, column: 'nope' }).success).toBe(false)
  })
  it('requires a non-empty id and workspaceId', () => {
    expect(ApiSessionSchema.safeParse({ ...SESSION, id: '' }).success).toBe(false)
    expect(ApiSessionSchema.safeParse({ ...SESSION, workspaceId: '' }).success).toBe(false)
  })
})

describe('ApiSessionListSchema', () => {
  it('is an array of the session projection, and fails closed on a bad member', () => {
    expect(ApiSessionListSchema.parse([SESSION])).toEqual([SESSION])
    expect(ApiSessionListSchema.safeParse([{ ...SESSION, latestMessage: 'x' }]).success).toBe(false)
  })
})

describe('SessionsCreateBodySchema', () => {
  it('defaults args to [] and applies the session-name rules', () => {
    expect(SessionsCreateBodySchema.parse({ templateId: 't', name: ' HT-1 ' })).toEqual({
      templateId: 't',
      name: 'HT-1',
      args: []
    })
    expect(SessionsCreateBodySchema.safeParse({ templateId: 't', name: '' }).success).toBe(false)
  })
  it('rejects unknown keys and a non-string arg', () => {
    expect(
      SessionsCreateBodySchema.safeParse({ templateId: 't', name: 'n', prompt: 'x' }).success
    ).toBe(false)
    expect(
      SessionsCreateBodySchema.safeParse({ templateId: 't', name: 'n', args: [1] }).success
    ).toBe(false)
  })
  it('requires a non-empty templateId', () => {
    expect(SessionsCreateBodySchema.safeParse({ templateId: '', name: 'n' }).success).toBe(false)
  })
})

describe('SessionsCreateOutputSchema', () => {
  it('carries the three ids and nothing else', () => {
    const out = { sessionId: 's1', terminalId: 't1', workspaceId: 'default' }
    expect(SessionsCreateOutputSchema.parse(out)).toEqual(out)
    expect(SessionsCreateOutputSchema.safeParse({ ...out, prompt: 'x' }).success).toBe(false)
    expect(SessionsCreateOutputSchema.safeParse({ ...out, terminalId: '' }).success).toBe(false)
  })
})

describe('SessionIdParamsSchema / EmptySchema', () => {
  it('the id param is non-empty', () => {
    expect(SessionIdParamsSchema.parse({ id: 's1' })).toEqual({ id: 's1' })
    expect(SessionIdParamsSchema.safeParse({ id: '' }).success).toBe(false)
  })
  it('the empty shape accepts nothing but {}', () => {
    expect(EmptySchema.parse({})).toEqual({})
    expect(EmptySchema.safeParse({ anything: 1 }).success).toBe(false)
  })
})

describe('SessionsListQuerySchema / ApiErrorBodySchema', () => {
  it('workspaceId is optional and must be non-empty when present', () => {
    expect(SessionsListQuerySchema.parse({})).toEqual({})
    expect(SessionsListQuerySchema.safeParse({ workspaceId: '' }).success).toBe(false)
  })
  it('error codes are enum-locked (the API owns them)', () => {
    expect(ApiErrorBodySchema.safeParse({ error: { code: 'nope' } }).success).toBe(false)
    expect(API_ERROR_CODES).toContain('spawn_timeout')
  })
  it('an error body carries the code and an optional path, and nothing else', () => {
    expect(ApiErrorBodySchema.parse({ error: { code: 'invalid_request', path: 'name' } })).toEqual({
      error: { code: 'invalid_request', path: 'name' }
    })
    expect(ApiErrorBodySchema.parse({ error: { code: 'internal' } })).toEqual({
      error: { code: 'internal' }
    })
    // Never a `message`/`detail` slot: an error body must not become a place a parsed
    // value gets echoed back to the caller.
    expect(
      ApiErrorBodySchema.safeParse({ error: { code: 'internal', message: 'x' } }).success
    ).toBe(false)
  })
  it('holds all 18 codes the API uses', () => {
    expect([...API_ERROR_CODES]).toEqual([
      'unauthorized',
      'invalid_json',
      'body_too_large',
      'invalid_request',
      'arg_invalid',
      'template_has_no_prompt',
      'prompt_too_long',
      'template_workspace_gone',
      'not_found',
      'template_not_found',
      'workspace_not_found',
      'session_not_found',
      'method_not_allowed',
      'claude_version',
      'no_window',
      'too_many_streams',
      'spawn_timeout',
      'internal'
    ])
  })
})

describe('ApiWorkspaceSchema', () => {
  const WS = { id: 'default', name: 'Default', color: 'slate', active: true }
  it('carries id, name, color and the active flag', () => {
    expect(ApiWorkspaceSchema.parse(WS)).toEqual(WS)
    expect(ApiWorkspaceListSchema.parse([WS])).toEqual([WS])
  })
  it('is strict: defaultCwd (the folder layout) is not part of the wire shape', () => {
    expect(ApiWorkspaceSchema.safeParse({ ...WS, defaultCwd: '/w' }).success).toBe(false)
  })
  it('color is one of the workspace colors', () => {
    expect(ApiWorkspaceSchema.safeParse({ ...WS, color: 'pink' }).success).toBe(false)
  })
})

describe('ApiTemplateSchema', () => {
  const TPL = {
    id: 'tpl',
    name: 'tickets',
    cwd: '/w',
    model: 'opus',
    permissionMode: null,
    effort: 'low',
    workspaceId: null,
    initialPrompt: 'Work on $1',
    params: [{ label: 'Ticket', pattern: '[A-Z]+-\\d+', maxLength: 10 }]
  }
  it('carries the whole template, nullable fields included', () => {
    expect(ApiTemplateSchema.parse(TPL)).toEqual(TPL)
    expect(ApiTemplateListSchema.parse([TPL])).toEqual([TPL])
  })
  it('is strict on the template AND on each param', () => {
    expect(ApiTemplateSchema.safeParse({ ...TPL, extra: 1 }).success).toBe(false)
    const badParam = { ...TPL, params: [{ ...TPL.params[0], extra: 1 }] }
    expect(ApiTemplateSchema.safeParse(badParam).success).toBe(false)
  })
  it('permissionMode and effort are the enum-locked CLI values', () => {
    expect(ApiTemplateSchema.safeParse({ ...TPL, permissionMode: 'yolo' }).success).toBe(false)
    expect(ApiTemplateSchema.safeParse({ ...TPL, effort: 'huge' }).success).toBe(false)
  })
})

describe('TemplatesListQuerySchema', () => {
  it('scope is optional and must be non-empty when present', () => {
    expect(TemplatesListQuerySchema.parse({})).toEqual({})
    expect(TemplatesListQuerySchema.parse({ scope: 'global' })).toEqual({ scope: 'global' })
    expect(TemplatesListQuerySchema.safeParse({ scope: '' }).success).toBe(false)
  })
  it('rejects an unknown query key', () => {
    expect(TemplatesListQuerySchema.safeParse({ workspaceId: 'ws2' }).success).toBe(false)
  })
})
