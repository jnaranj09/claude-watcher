import { describe, it, expect } from 'vitest'
import { sessionsListCommand } from './sessionsList'
import { sessionsGetCommand } from './sessionsGet'
import { sessionsCreateCommand } from './sessionsCreate'
import { sessionsEventsCommand } from './sessionsEvents'
import { workspacesListCommand } from './workspacesList'
import { templatesListCommand } from './templatesList'
import { apiCommands } from './index'
import { makeFakeContext, makeFakeSeam } from '../testSupport'
import type { ApiSession } from '../../../shared/schemas/api'

const S = (id: string, workspaceId = 'default'): ApiSession => ({
  id,
  sessionName: id,
  status: 'Working',
  column: 'working',
  enteredColumnAt: 1,
  workspaceId,
  tagIds: [],
  projectPath: '/w'
})
const input = (
  params: unknown = {},
  query: unknown = {}
): { params: unknown; query: unknown; body: unknown } => ({ params, query, body: undefined })

describe('GET /v1/sessions', () => {
  it('lists every session; workspaceId narrows it', async () => {
    const { ctx } = makeFakeContext({ seam: makeFakeSeam([S('a'), S('b', 'ws2')]) })
    const all = await sessionsListCommand.handler!(ctx, input())
    expect(all).toMatchObject({ ok: true, status: 200 })
    expect(all.ok && (all.body as ApiSession[]).map((s) => s.id)).toEqual(['a', 'b'])
    const some = await sessionsListCommand.handler!(ctx, input({}, { workspaceId: 'ws2' }))
    expect(some.ok && (some.body as ApiSession[]).map((s) => s.id)).toEqual(['b'])
  })
  it('answers 503 no_window without a seam', async () => {
    const { ctx } = makeFakeContext({ seam: null })
    expect(await sessionsListCommand.handler!(ctx, input())).toEqual({
      ok: false,
      status: 503,
      code: 'no_window'
    })
  })
})

describe('GET /v1/sessions/{id}', () => {
  it('returns the session or 404 session_not_found', async () => {
    const { ctx } = makeFakeContext({ seam: makeFakeSeam([S('a')]) })
    expect(await sessionsGetCommand.handler!(ctx, input({ id: 'a' }))).toMatchObject({
      ok: true,
      body: { id: 'a' }
    })
    expect(await sessionsGetCommand.handler!(ctx, input({ id: 'zz' }))).toEqual({
      ok: false,
      status: 404,
      code: 'session_not_found'
    })
  })
  it('answers 503 no_window without a seam', async () => {
    const { ctx } = makeFakeContext({ seam: null })
    expect(await sessionsGetCommand.handler!(ctx, input({ id: 'a' }))).toEqual({
      ok: false,
      status: 503,
      code: 'no_window'
    })
  })
})

describe('apiCommands', () => {
  it('carries every command exactly once, in document order', () => {
    expect(apiCommands.map((c) => c.id)).toEqual([
      'sessions.create',
      'sessions.list',
      'sessions.get',
      'sessions.events',
      'workspaces.list',
      'templates.list'
    ])
    for (const c of [
      sessionsCreateCommand,
      sessionsListCommand,
      sessionsGetCommand,
      sessionsEventsCommand,
      workspacesListCommand,
      templatesListCommand
    ]) {
      expect(apiCommands).toContain(c)
    }
  })
})
