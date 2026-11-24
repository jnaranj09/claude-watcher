// `GET /v1/sessions/{id}/events` behaviours the mutation run (StrykerJS) showed no test pinned:
// the name of a later delta frame, a delta the wire shape refuses sending no frame, and the
// stream's responses in the OpenAPI document. Driven through the real server.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { sessionsEventsCommand } from './sessionsEvents'
import { startTestServer, call, makeFakeContext, makeFakeSeam } from '../testSupport'
import { buildOpenApiDocument } from '../openapi'
import type { ApiServer } from '../apiServer'
import type { ApiSession } from '../../../shared/schemas/api'

const S: ApiSession = {
  id: 's1',
  sessionName: 'HT-1',
  status: 'Connecting',
  column: 'working',
  enteredColumnAt: 1,
  workspaceId: 'default',
  tagIds: [],
  projectPath: '/w'
}

const WORKING = {
  type: 'session.updated' as const,
  id: 's1',
  sessionName: 'HT-1',
  projectPath: '/w',
  status: 'Working',
  column: 'working' as const,
  enteredColumnAt: 2,
  pid: 1,
  workspaceId: 'default',
  tagIds: []
}

let server: ApiServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

describe('GET /v1/sessions/{id}/events — later frames', () => {
  it('names a later delta frame session.updated', async () => {
    const seam = makeFakeSeam([S])
    const { ctx } = makeFakeContext({ seam })
    const s = await startTestServer([sessionsEventsCommand], ctx, { pingMs: 100_000 })
    server = s.server
    const done = call(s.url, 'GET', '/v1/sessions/s1/events')
    await vi.waitFor(() => expect(s.server.streams()).toBe(1))
    seam.emit(WORKING)
    seam.emit({ type: 'session.removed', id: 's1', sessionName: 'HT-1', projectPath: '/w' })
    const frames = (await done).text.trim().split('\n\n')
    expect(frames[1]?.startsWith('id: 2\nevent: session.updated\n')).toBe(true)
  })

  it('sends no frame for a delta the state-only wire shape refuses', async () => {
    const seam = makeFakeSeam([S])
    const { ctx } = makeFakeContext({ seam })
    const s = await startTestServer([sessionsEventsCommand], ctx, { pingMs: 100_000 })
    server = s.server
    const done = call(s.url, 'GET', '/v1/sessions/s1/events')
    await vi.waitFor(() => expect(s.server.streams()).toBe(1))
    seam.emit({ ...WORKING, tagIds: [''] })
    seam.emit({ type: 'session.removed', id: 's1', sessionName: 'HT-1', projectPath: '/w' })
    const frames = (await done).text.trim().split('\n\n')
    expect(frames).toEqual([
      `id: 1\nevent: session.updated\ndata: ${JSON.stringify(S)}`,
      'id: 2\nevent: session.removed\ndata: {"id":"s1"}'
    ])
  })
})

describe('GET /v1/sessions/{id}/events — the OpenAPI document', () => {
  it('documents a text/event-stream success and the 401, 404 and 503 errors', () => {
    const doc = buildOpenApiDocument([sessionsEventsCommand], { port: 1, version: '1' })
    expect(doc).toMatchObject({
      paths: {
        '/v1/sessions/{id}/events': {
          get: {
            responses: {
              '200': { content: { 'text/event-stream': {} } },
              '401': {},
              '404': {},
              '503': {}
            }
          }
        }
      }
    })
  })
})
