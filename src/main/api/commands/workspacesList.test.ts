// Programmatic API — `GET /v1/workspaces`, driven over a REAL loopback listener so the output is
// validated at source against `ApiWorkspaceListSchema` exactly as it is in production.
import { describe, it, expect, afterEach } from 'vitest'
import { workspacesListCommand } from './workspacesList'
import { makeFakeContext, startTestServer, call, type Reply } from '../testSupport'
import type { ApiServer } from '../apiServer'
import type { Workspace } from '../../../shared/schemas/workspace'

const DEFAULT: Workspace = { id: 'default', name: 'Default', color: 'slate', defaultCwd: null }
const TWO: Workspace = { id: 'ws2', name: 'Two', color: 'blue', defaultCwd: '/home/op/two' }

let server: ApiServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

async function get(workspaces: Workspace[], activeWorkspaceId: string): Promise<Reply> {
  const { ctx } = makeFakeContext({ workspaces, activeWorkspaceId })
  const started = await startTestServer([workspacesListCommand], ctx)
  server = started.server
  return call(started.url, 'GET', '/v1/workspaces')
}

describe('GET /v1/workspaces', () => {
  it('lists every workspace in saved order, marking the active one', async () => {
    const reply = await get([DEFAULT, TWO], 'ws2')
    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.text)).toEqual([
      { id: 'default', name: 'Default', color: 'slate', active: false },
      { id: 'ws2', name: 'Two', color: 'blue', active: true }
    ])
  })

  it('never sends defaultCwd', async () => {
    const reply = await get([TWO], 'ws2')
    expect(reply.text).not.toContain('defaultCwd')
    expect(reply.text).not.toContain('/home/op/two')
  })

  it('refuses a query key it does not take', async () => {
    const { ctx } = makeFakeContext({ workspaces: [DEFAULT] })
    const started = await startTestServer([workspacesListCommand], ctx)
    server = started.server
    const reply = await call(started.url, 'GET', '/v1/workspaces?scope=global')
    expect(reply.status).toBe(400)
    // An unrecognized key is a ROOT issue in zod (the path names the object, not the key).
    expect(JSON.parse(reply.text)).toEqual({ error: { code: 'invalid_request', path: '(root)' } })
  })

  it('answers without a window — the store lives in main', async () => {
    const { ctx } = makeFakeContext({ seam: null, workspaces: [DEFAULT] })
    const started = await startTestServer([workspacesListCommand], ctx)
    server = started.server
    expect((await call(started.url, 'GET', '/v1/workspaces')).status).toBe(200)
  })
})
