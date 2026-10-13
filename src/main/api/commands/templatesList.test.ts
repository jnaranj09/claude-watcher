// Programmatic API — `GET /v1/templates`, driven over a REAL loopback listener so the query is
// parsed by `TemplatesListQuerySchema` and the output validated at source, as in production.
//
// The scope filter is STRICT both ways, like the Manage dialog's: a workspace scope never pulls in
// the global templates, because a global template launched through the API lands in the ACTIVE
// workspace, not in the one the caller asked about.
import { describe, it, expect, afterEach } from 'vitest'
import { templatesListCommand } from './templatesList'
import { makeFakeContext, startTestServer, call, type Reply } from '../testSupport'
import type { ApiServer } from '../apiServer'
import type { Template } from '../../../shared/schemas/template'
import type { Workspace } from '../../../shared/schemas/workspace'

const tpl = (id: string, workspaceId: string | null): Template => ({
  id,
  name: id,
  cwd: '/w',
  model: null,
  permissionMode: null,
  effort: null,
  workspaceId,
  initialPrompt: null,
  params: [],
  favorite: false
})
const GLOBAL = tpl('g', null)
const IN_TWO = tpl('two', 'ws2')
const IN_DEFAULT = tpl('def', 'default')
const WORKSPACES: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'ws2', name: 'Two', color: 'blue', defaultCwd: null }
]

let server: ApiServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

async function get(
  path: string,
  templates: Template[] = [IN_DEFAULT, GLOBAL, IN_TWO]
): Promise<Reply> {
  const { ctx } = makeFakeContext({ templates, workspaces: WORKSPACES })
  const started = await startTestServer([templatesListCommand], ctx)
  server = started.server
  return call(started.url, 'GET', path)
}
const ids = (reply: Reply): string[] =>
  (JSON.parse(reply.text) as Array<{ id: string }>).map((t) => t.id)

describe('GET /v1/templates', () => {
  it('lists every template in saved order without a scope', async () => {
    const reply = await get('/v1/templates')
    expect(reply.status).toBe(200)
    expect(ids(reply)).toEqual(['def', 'g', 'two'])
  })

  it('scope=global lists the global templates only', async () => {
    expect(ids(await get('/v1/templates?scope=global'))).toEqual(['g'])
  })

  it('a workspace scope is STRICT — the global templates are not merged in', async () => {
    expect(ids(await get('/v1/templates?scope=ws2'))).toEqual(['two'])
  })

  it('sends the whole template, prompt and params included', async () => {
    const full: Template = {
      ...IN_TWO,
      model: 'opus',
      permissionMode: 'plan',
      effort: 'high',
      initialPrompt: 'Work on $1',
      params: [{ label: 'Ticket', pattern: '[A-Z]+-\\d+', maxLength: 10 }],
      favorite: true
    }
    const reply = await get('/v1/templates?scope=ws2', [full])
    // Favorites are app-only: the API never sends the star.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { favorite: _favorite, ...wire } = full
    expect(JSON.parse(reply.text)).toEqual([wire])
  })

  it('an unknown workspace scope is 404 workspace_not_found, not an empty list', async () => {
    const reply = await get('/v1/templates?scope=gone')
    expect(reply.status).toBe(404)
    expect(JSON.parse(reply.text)).toEqual({ error: { code: 'workspace_not_found' } })
  })

  it('an empty scope is a caller bug, not "all"', async () => {
    const reply = await get('/v1/templates?scope=')
    expect(reply.status).toBe(400)
    expect(JSON.parse(reply.text)).toEqual({ error: { code: 'invalid_request', path: 'scope' } })
  })

  it('answers without a window — the store lives in main', async () => {
    const { ctx } = makeFakeContext({ seam: null, templates: [GLOBAL] })
    const started = await startTestServer([templatesListCommand], ctx)
    server = started.server
    expect((await call(started.url, 'GET', '/v1/templates')).status).toBe(200)
  })
})
