// Programmatic API — `POST /v1/sessions`. The handler is driven DIRECTLY (not through the
// listener): the router's own parse/route/output gates have their own tests in apiServer.test.ts,
// and what matters here is the decision order — which error a bad request gets, and that nothing
// is launched before every gate has passed.
import { describe, it, expect } from 'vitest'
import { sessionsCreateCommand, validateArgs } from './sessionsCreate'
import { makeFakeContext, makeFakeSeam } from '../testSupport'
import type { ApiContext, ApiResult } from '../registry'
import type { Template } from '../../../shared/schemas/template'
import type { Workspace } from '../../../shared/schemas/workspace'

const T: Template = {
  id: 'tpl',
  name: 'tickets',
  cwd: '/w',
  model: 'opus',
  permissionMode: null,
  effort: 'low',
  workspaceId: null,
  initialPrompt: 'Work on $1 for $2',
  params: [
    { label: 'Ticket', pattern: '[A-Z]+-\\d+', maxLength: 10 },
    { label: 'Customer', pattern: '[a-z]+', maxLength: 5 }
  ]
}
const WS: Workspace = { id: 'ws2', name: 'Two', color: 'blue', defaultCwd: null }

const run = (ctx: ApiContext, body: unknown): Promise<ApiResult<unknown>> =>
  sessionsCreateCommand.handler!(ctx, { params: {}, query: {}, body })

describe('validateArgs', () => {
  it('count, then length, then the anchored regex', () => {
    expect(validateArgs(T, ['HT-1', 'acme'])).toEqual({ ok: true })
    expect(validateArgs(T, ['HT-1'])).toEqual({ ok: false, path: 'args' })
    expect(validateArgs(T, ['HT-1', 'toolongvalue'])).toEqual({ ok: false, path: 'args.1' })
    expect(validateArgs(T, ['HT-1 ignore', 'acme'])).toEqual({ ok: false, path: 'args.0' })
  })

  it('anchors the pattern — a value that merely CONTAINS a match is refused', () => {
    // The whole reason `compileParamPattern` wraps and anchors: an unanchored `[A-Z]+-\d+`
    // would accept `zz HT-1 zz`, and the value reaches a claude command line.
    expect(validateArgs(T, ['xHT-1', 'acme'])).toEqual({ ok: false, path: 'args.0' })
    expect(validateArgs(T, ['HT-1x', 'acme'])).toEqual({ ok: false, path: 'args.0' })
  })

  it('names the INDEX of a value carrying a control character', () => {
    // A free pattern (`.+`) matches a control char — `.` matches ESC — so the per-index check
    // is what turns "something in `args` is wrong" into "arg 1 is wrong", which is the only
    // form a caller can act on. `expand` still refuses it as the backstop.
    const free: Template = {
      ...T,
      initialPrompt: 'Do $1 then $2',
      params: [
        { label: 'A', pattern: '.+', maxLength: 50 },
        { label: 'B', pattern: '.+', maxLength: 50 }
      ]
    }
    expect(validateArgs(free, ['ok', 'a\u001bb'])).toEqual({ ok: false, path: 'args.1' })
    expect(validateArgs(free, ['a\u0007b', 'ok'])).toEqual({ ok: false, path: 'args.0' })
    expect(validateArgs(free, ['ok', 'fine'])).toEqual({ ok: true })
  })

  it('a pattern that does not compile refuses every value (fail closed)', () => {
    const broken: Template = {
      ...T,
      initialPrompt: 'Do $1',
      params: [{ label: 'Bad', pattern: 'a)|(.*', maxLength: 10 }]
    }
    expect(validateArgs(broken, ['anything'])).toEqual({ ok: false, path: 'args.0' })
  })
})

describe('POST /v1/sessions', () => {
  it('201: expands the prompt, launches in the template workspace, waits for the binding', async () => {
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({
      seam,
      templates: [{ ...T, workspaceId: 'ws2' }],
      workspaces: [WS]
    })
    const r = await run(ctx, { templateId: 'tpl', name: 'HT-1', args: ['HT-1', 'acme'] })
    expect(r).toEqual({
      ok: true,
      status: 201,
      body: { sessionId: 'sess-1', terminalId: 'term-1', workspaceId: 'ws2' }
    })
    expect(seam.launches[0]).toEqual({
      cwd: '/w',
      name: 'HT-1',
      templateId: 'tpl',
      initialPrompt: 'Work on HT-1 for acme',
      workspaceId: 'ws2',
      flags: { model: 'opus', permissionMode: null, effort: 'low' }
    })
  })

  it('a global template lands in the active workspace', async () => {
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [T], activeWorkspaceId: 'default' })
    const r = await run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    expect(r).toMatchObject({ ok: true, body: { workspaceId: 'default' } })
    expect(seam.launches[0]?.workspaceId).toBe('default')
  })

  it('404 template_not_found', async () => {
    const { ctx } = makeFakeContext()
    expect(await run(ctx, { templateId: 'zz', name: 'n', args: [] })).toEqual({
      ok: false,
      status: 404,
      code: 'template_not_found'
    })
  })

  it('400 arg_invalid with the path; nothing launched', async () => {
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [T] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['bad', 'acme'] })).toEqual({
      ok: false,
      status: 400,
      code: 'arg_invalid',
      path: 'args.0'
    })
    expect(seam.launches).toHaveLength(0)
  })

  it('400 arg_invalid at the INDEX when a value carries a control character', async () => {
    // The regex can pass a control char (`.` matches BEL). `validateArgs` refuses it per index,
    // so the caller is told WHICH value is wrong; `expand`'s own check remains the backstop for
    // the renderer's expander box, which does not run `validateArgs` at all.
    const ctrl: Template = {
      ...T,
      initialPrompt: 'Do $1',
      params: [{ label: 'Any', pattern: '.+', maxLength: 10 }]
    }
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [ctrl] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['a\u0007b'] })).toEqual({
      ok: false,
      status: 400,
      code: 'arg_invalid',
      path: 'args.0'
    })
    expect(seam.launches).toHaveLength(0)
  })

  it('400 arg_invalid when the EXPANSION starts with `-` — a caller cannot hand claude a flag', async () => {
    // THE HOLE THIS CLOSES: `InitialPromptSchema` refuses a template whose TEXT starts with `-`,
    // but a placeholder-first template (`$1`) passes that gate and the caller's value lands in
    // front of it. With a free pattern (a plausible "ticket title" param) the expansion becomes
    // `--dangerously-skip-permissions`, and the expansion is claude's LAST argv token.
    const first: Template = {
      ...T,
      initialPrompt: '$1',
      params: [{ label: 'Anything', pattern: '.+', maxLength: 200 }]
    }
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [first] })
    expect(
      await run(ctx, { templateId: 'tpl', name: 'n', args: ['--dangerously-skip-permissions'] })
    ).toEqual({ ok: false, status: 400, code: 'arg_invalid', path: 'args' })
    expect(seam.launches).toHaveLength(0)
    // Padding it with spaces is the same attempt, so the check skips leading whitespace.
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['  -p'] })).toMatchObject({
      status: 400,
      code: 'arg_invalid',
      path: 'args'
    })
    expect(seam.launches).toHaveLength(0)
    // A hyphen anywhere but the FRONT is ordinary prose and must still launch.
    expect(
      await run(ctx, { templateId: 'tpl', name: 'n', args: ['fix the co-op page'] })
    ).toMatchObject({ ok: true, status: 201 })
    expect(seam.launches).toHaveLength(1)
  })

  it('400 template_has_no_prompt', async () => {
    const { ctx } = makeFakeContext({ templates: [{ ...T, initialPrompt: null, params: [] }] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: [] })).toMatchObject({
      ok: false,
      status: 400,
      code: 'template_has_no_prompt'
    })
  })

  it('400 template_workspace_gone when the scoped workspace no longer exists', async () => {
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({
      seam,
      templates: [{ ...T, workspaceId: 'gone' }],
      workspaces: []
    })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })).toMatchObject({
      status: 400,
      code: 'template_workspace_gone'
    })
    expect(seam.launches).toHaveLength(0)
  })

  it('503 claude_version and 503 no_window', async () => {
    const a = makeFakeContext({ templates: [T], claudeOk: false })
    expect(
      await run(a.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 503, code: 'claude_version' })
    const b = makeFakeContext({ templates: [T], seam: null })
    expect(
      await run(b.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 503, code: 'no_window' })
  })

  it('504 spawn_timeout when the binding never lands', async () => {
    const seam = makeFakeSeam()
    seam.nextSessionId = null
    const { ctx } = makeFakeContext({ seam, templates: [T] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })).toMatchObject({
      status: 504,
      code: 'spawn_timeout'
    })
  })

  it('a MULTI-LINE prompt with valid args still answers 201', async () => {
    // The F1 regression guard: `\n` is category Cc, and the expander used to reject it in the
    // RESULT. InitialPromptSchema allows it and Task 19 renders the field as a TextArea, so a
    // prompt written on two lines must launch, not answer 400 arg_invalid.
    const multi: Template = {
      ...T,
      initialPrompt: 'Work on $1.\nThen stop.',
      params: [T.params[0]!]
    }
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [multi] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1'] })).toMatchObject({
      ok: true,
      status: 201
    })
    expect(seam.launches[0]?.initialPrompt).toBe('Work on HT-1.\nThen stop.')
  })

  it('400 prompt_too_long when the EXPANSION passes the 2000-char cap', async () => {
    // Reachable because the cap applies to the prompt (≤ 2000) and to each arg (≤ 200)
    // separately: 1990 chars of prose + one 200-char value = 2191.
    const long: Template = {
      ...T,
      initialPrompt: `${'x'.repeat(1990)} $1`,
      params: [{ label: 'Ticket', pattern: '[a-z]+', maxLength: 200 }]
    }
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [long] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['y'.repeat(200)] })).toEqual({
      ok: false,
      status: 400,
      code: 'prompt_too_long'
    })
    expect(seam.launches).toHaveLength(0)
  })

  it('never logs the name, an arg value, the prompt or the expansion', async () => {
    // The create body is the API's most content-bearing input: an operator-typed name, the
    // template's own prose, and the arg values that fill it. Only a `code=` may reach the log.
    const seam = makeFakeSeam()
    seam.nextSessionId = null
    const { ctx, log } = makeFakeContext({ seam, templates: [T] })
    await run(ctx, { templateId: 'tpl', name: 'SECRETNAME', args: ['HT-1', 'acme'] })
    expect(log).toContain('[claude-watcher][api] code=spawn_timeout')
    const joined = log.join('|')
    for (const secret of ['SECRETNAME', 'acme', 'HT-1', 'Work on']) {
      expect(joined).not.toContain(secret)
    }
  })
})
