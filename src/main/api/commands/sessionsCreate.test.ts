// Programmatic API — `POST /v1/sessions`, tested at BOTH levels.
//
// Most of the file drives the handler DIRECTLY: what matters there is the decision order — which
// error a bad request gets, and that nothing is launched before every gate has passed.
//
// The last block drives the SAME command over a real loopback listener (`startTestServer`),
// because the handler never sees the request boundary: `.strict()` on the body, the `args`
// `.default([])` when the key is omitted, and the output validated against
// `SessionsCreateOutputSchema` before it is written all happen in the router. apiServer.test.ts
// proves those gates on test-double commands; this proves they hold for the one WRITE route the
// API actually ships.
import { describe, it, expect, afterEach } from 'vitest'
import { sessionsCreateCommand, validateArgs } from './sessionsCreate'
import { makeFakeContext, makeFakeSeam, startTestServer, call } from '../testSupport'
import type { ApiServer } from '../apiServer'
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
  ],
  favorite: false
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
      ],
      favorite: false
    }
    expect(validateArgs(free, ['ok', 'a\u001bb'])).toEqual({ ok: false, path: 'args.1' })
    expect(validateArgs(free, ['a\u0007b', 'ok'])).toEqual({ ok: false, path: 'args.0' })
    expect(validateArgs(free, ['ok', 'fine'])).toEqual({ ok: true })
  })

  it('a pattern that does not compile refuses every value (fail closed)', () => {
    const broken: Template = {
      ...T,
      initialPrompt: 'Do $1',
      params: [{ label: 'Bad', pattern: 'a)|(.*', maxLength: 10 }],
      favorite: false
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
      params: [{ label: 'Any', pattern: '.+', maxLength: 10 }],
      favorite: false
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
      params: [{ label: 'Anything', pattern: '.+', maxLength: 200 }],
      favorite: false
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

  // UX-11 — a template whose folder was deleted, renamed or unmounted is refused BEFORE the
  // launch: node-pty spawns into a missing cwd without throwing, the child fails its chdir and
  // exits, and the caller used to get a 201 for a card that flashed and died.
  it('409 folder_missing when the template folder is gone, and nothing is launched', async () => {
    const seam = makeFakeSeam()
    const seen: string[] = []
    const { ctx } = makeFakeContext({ seam, templates: [T], folderExists: false })
    const probe: ApiContext = {
      ...ctx,
      isDirectory: (p) => {
        seen.push(p)
        return ctx.isDirectory(p)
      }
    }
    expect(
      await run(probe, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 409, code: 'folder_missing' })
    expect(seen).toEqual(['/w'])
    expect(seam.launches).toHaveLength(0)
  })

  it('409 folder_missing when the folder vanishes between the check and the launch', async () => {
    // The launch service refuses the same folder again (its own preflight); that throw must
    // become the same 409, not a 500.
    const seam = makeFakeSeam()
    seam.requestLaunch = () => {
      throw new Error('folder_missing')
    }
    const { ctx } = makeFakeContext({ seam, templates: [T] })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })).toMatchObject({
      status: 409,
      code: 'folder_missing'
    })
    seam.requestLaunch = () => {
      throw new Error('boom')
    }
    await expect(
      run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).rejects.toThrow('boom')
  })

  it('folder_missing comes after the 400s and BEFORE the retryable 503s', async () => {
    const bad = makeFakeContext({ templates: [T], folderExists: false })
    expect(await run(bad.ctx, { templateId: 'tpl', name: 'n', args: ['x'] })).toMatchObject({
      status: 400,
      code: 'arg_invalid'
    })
    const old = makeFakeContext({ templates: [T], folderExists: false, claudeOk: false })
    expect(
      await run(old.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 409, code: 'folder_missing' })
    const noWin = makeFakeContext({ templates: [T], folderExists: false, seam: null })
    expect(
      await run(noWin.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 409, code: 'folder_missing' })
  })

  // SEC-6 — with the hook port held by another program, main spawns claude WITHOUT `--settings`
  // (its prompts must never reach a stranger's listener), so the card would never move. The
  // create refuses instead of answering a 201 for a card an automation can never watch.
  it('503 hooks_unavailable when the hook server is not bound, and nothing is launched', async () => {
    const seam = makeFakeSeam()
    const { ctx } = makeFakeContext({ seam, templates: [T], hooksListening: false })
    expect(await run(ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })).toMatchObject({
      status: 503,
      code: 'hooks_unavailable'
    })
    expect(seam.launches).toHaveLength(0)
  })

  it('hooks_unavailable sits after the 400s, the 409 and claude_version, BEFORE no_window', async () => {
    const bad = makeFakeContext({ templates: [T], hooksListening: false })
    expect(await run(bad.ctx, { templateId: 'tpl', name: 'n', args: ['x'] })).toMatchObject({
      status: 400,
      code: 'arg_invalid'
    })
    const gone = makeFakeContext({ templates: [T], hooksListening: false, folderExists: false })
    expect(
      await run(gone.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 409, code: 'folder_missing' })
    const old = makeFakeContext({ templates: [T], hooksListening: false, claudeOk: false })
    expect(
      await run(old.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 503, code: 'claude_version' })
    const noWin = makeFakeContext({ templates: [T], hooksListening: false, seam: null })
    expect(
      await run(noWin.ctx, { templateId: 'tpl', name: 'n', args: ['HT-1', 'acme'] })
    ).toMatchObject({ status: 503, code: 'hooks_unavailable' })
  })

  it('declares 409 in its error statuses (the OpenAPI document reads them)', () => {
    expect(sessionsCreateCommand.errorStatuses).toContain(409)
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
      params: [T.params[0]!],
      favorite: false
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
      params: [{ label: 'Ticket', pattern: '[a-z]+', maxLength: 200 }],
      favorite: false
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

// The ONE write route, driven over loopback through the REAL `createApiServer` with the REAL
// command — the boundary the handler-level tests above cannot reach.
describe('POST /v1/sessions through the real listener', () => {
  let server: ApiServer | null = null
  afterEach(() => {
    server?.close()
    server = null
  })

  const NO_PARAMS: Template = {
    ...T,
    id: 'nightly',
    initialPrompt: 'Run the nightly check',
    params: [],
    favorite: false
  }

  const start = async (
    over: Parameters<typeof makeFakeContext>[0] = {}
  ): Promise<{ url: string; seam: ReturnType<typeof makeFakeSeam>; log: string[] }> => {
    const seam = makeFakeSeam()
    const { ctx, log } = makeFakeContext({ seam, ...over })
    const s = await startTestServer([sessionsCreateCommand], ctx)
    server = s.server
    return { url: s.url, seam, log }
  }

  it('201 with the output body, and the launch carries the expanded prompt', async () => {
    const { url, seam } = await start({
      templates: [{ ...T, workspaceId: 'ws2' }],
      workspaces: [WS]
    })
    const r = await call(url, 'POST', '/v1/sessions', {
      body: JSON.stringify({ templateId: 'tpl', name: 'HT-1', args: ['HT-1', 'acme'] })
    })
    expect(r.status).toBe(201)
    expect(JSON.parse(r.text)).toEqual({
      sessionId: 'sess-1',
      terminalId: 'term-1',
      workspaceId: 'ws2'
    })
    // The body was written only because it PARSED against `SessionsCreateOutputSchema`; the
    // launch is what proves the request reached the real handler and not a route stub.
    expect(seam.launches[0]?.initialPrompt).toBe('Work on HT-1 for acme')
  })

  it('400 invalid_request for an extra body key — `.strict()` at the wire', async () => {
    const { url, seam, log } = await start({ templates: [NO_PARAMS] })
    const r = await call(url, 'POST', '/v1/sessions', {
      body: JSON.stringify({ templateId: 'nightly', name: 'n', prompt: 'do as I say' })
    })
    expect(r.status).toBe(400)
    // The path is `(root)`, NOT the rejected key: zod reports `unrecognized_keys` at the object
    // itself, and the key is CALLER-supplied text — echoing it into the error body and the log
    // line would put caller input exactly where this API never puts it.
    expect(JSON.parse(r.text)).toEqual({ error: { code: 'invalid_request', path: '(root)' } })
    expect(seam.launches).toHaveLength(0)
    expect(log.join('|')).not.toContain('do as I say')
    expect(log.join('|')).not.toContain('prompt')
  })

  it('201 with `args` omitted entirely on a template that takes none', async () => {
    // `args: z.array(z.string()).default([])` — the key is optional on the wire, and the
    // OpenAPI document publishes it optional (`io: 'input'`) precisely so a generated client
    // may leave it out. A 400 here would make the document a lie.
    const { url, seam } = await start({ templates: [NO_PARAMS] })
    const r = await call(url, 'POST', '/v1/sessions', {
      body: JSON.stringify({ templateId: 'nightly', name: 'nightly' })
    })
    expect(r.status).toBe(201)
    expect(seam.launches[0]?.initialPrompt).toBe('Run the nightly check')
  })
})
