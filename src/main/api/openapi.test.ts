// Programmatic API — the OpenAPI document is GENERATED from the same `apiCommands` the router
// dispatches, so these tests are about that identity: every registry command has an operation,
// every declared error status has a response, and the shared schemas are hoisted so a client's
// generator emits ONE `ApiSession` type instead of four inline copies.
//
// The two conversions that are easy to get wrong and are pinned here:
//   - a REQUEST body is converted with `io: 'input'`, so `args` (which has a `.default([])`) is
//     published OPTIONAL. With the default (`io: 'output'`) it is published REQUIRED and every
//     generated client is forced to send it.
//   - `$schema` is stripped: a draft-2020-12 `$schema` key inside an OpenAPI 3.1 schema object is
//     not part of the 3.1 schema object shape and trips strict validators.
import { describe, it, expect } from 'vitest'
import { API_ERROR_CODES } from '../../shared/schemas/api'
import { buildOpenApiDocument } from './openapi'
import { apiCommands } from './commands'

interface Operation {
  operationId: string
  summary: string
  description?: string
  responses: Record<string, unknown>
  requestBody?: unknown
  parameters?: Array<{ name: string; in: string }>
}
interface Doc {
  openapi: string
  info: { title: string; version: string }
  servers: Array<{ url: string }>
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Record<string, unknown>>; securitySchemes: unknown }
  security: unknown[]
}

const doc = buildOpenApiDocument(apiCommands, { port: 9281, version: '2.1.0' }) as unknown as Doc

describe('buildOpenApiDocument', () => {
  it('is OpenAPI 3.1 with the local server and the bearer scheme', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.version).toBe('2.1.0')
    expect(doc.servers).toEqual([{ url: 'http://127.0.0.1:9281' }])
    expect(doc.components.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer' }
    })
    expect(doc.security).toEqual([{ bearerAuth: [] }])
  })

  it('has one operation per registry command, keyed by its path and method', () => {
    for (const c of apiCommands) {
      const op = doc.paths[c.path]?.[c.method.toLowerCase()]
      expect(op?.operationId).toBe(c.id)
      expect(op?.summary).toBe(c.summary)
      expect(Object.keys(op?.responses ?? {})).toEqual(
        expect.arrayContaining([String(c.successStatus), ...c.errorStatuses.map(String)])
      )
    }
  })

  it('documents path params, the create body and the SSE content type', () => {
    expect(doc.paths['/v1/sessions/{id}']?.get?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }
    ])
    expect(doc.paths['/v1/sessions']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/SessionsCreateBody' } }
      }
    })
    const sse = doc.paths['/v1/sessions/{id}/events']?.get?.responses['200'] as {
      content: Record<string, unknown>
    }
    expect(Object.keys(sse.content)).toEqual(['text/event-stream'])
  })

  it('documents the optional list query as a query parameter', () => {
    expect(doc.paths['/v1/sessions']?.get?.parameters).toEqual([
      {
        name: 'workspaceId',
        in: 'query',
        required: false,
        schema: { type: 'string', minLength: 1 }
      }
    ])
  })

  it('hoists the shared schemas and every error response references ApiError', () => {
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining([
        'ApiSession',
        'ApiError',
        'SessionsCreateBody',
        'SessionsCreateOutput',
        'ApiWorkspace',
        'ApiTemplate'
      ])
    )
    const notFound = doc.paths['/v1/sessions/{id}']?.get?.responses['404'] as {
      content: Record<string, { schema: unknown }>
    }
    expect(notFound.content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ApiError'
    })
  })

  it('references the hoisted ApiSession from the list response and the get response', () => {
    const list = doc.paths['/v1/sessions']?.get?.responses['200'] as {
      content: Record<string, { schema: unknown }>
    }
    expect(list.content['application/json']?.schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ApiSession' }
    })
    const one = doc.paths['/v1/sessions/{id}']?.get?.responses['200'] as {
      content: Record<string, { schema: unknown }>
    }
    expect(one.content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ApiSession'
    })
  })

  it('references the hoisted ApiWorkspace and ApiTemplate from the two catalog lists', () => {
    const workspaces = doc.paths['/v1/workspaces']?.get?.responses['200'] as {
      content: Record<string, { schema: unknown }>
    }
    expect(workspaces.content['application/json']?.schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ApiWorkspace' }
    })
    const templates = doc.paths['/v1/templates']?.get?.responses['200'] as {
      content: Record<string, { schema: unknown }>
    }
    expect(templates.content['application/json']?.schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ApiTemplate' }
    })
  })

  it('documents the templates scope as an optional query parameter that says what it takes', () => {
    const params = doc.paths['/v1/templates']?.get?.parameters as Array<{
      name: string
      in: string
      required: boolean
      schema: { description?: string }
    }>
    expect(params.map((p) => [p.name, p.in, p.required])).toEqual([['scope', 'query', false]])
    expect(params[0]?.schema.description).toContain('global')
  })

  it('publishes the create body with io:input, so the defaulted `args` is OPTIONAL', () => {
    const body = doc.components.schemas['SessionsCreateBody']
    expect(body?.['required']).toEqual(['templateId', 'name'])
    expect(Object.keys((body?.['properties'] ?? {}) as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['templateId', 'name', 'args'])
    )
  })

  it('states the name rules JSON Schema cannot carry, instead of pretending it does', () => {
    const props = doc.components.schemas['SessionsCreateBody']?.['properties'] as Record<
      string,
      { description?: string; maxLength?: number }
    >
    // `.trim()` and the control-character `.refine()` do not survive the conversion — only the
    // length bounds do. The prose says so rather than leaving a client to discover it as a 400.
    expect(props['name']?.maxLength).toBe(60)
    expect(props['name']?.description).toContain('control characters')
  })

  it('documents 409 folder_missing on sessions.create (UX-11)', () => {
    const conflict = doc.paths['/v1/sessions']?.post?.responses['409'] as {
      description: string
      content: Record<string, { schema: unknown }>
    }
    expect(conflict.description).toBe('Conflict')
    expect(conflict.content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ApiError'
    })
    expect(API_ERROR_CODES).toContain('folder_missing')
  })

  it('hoists the SSE frame shapes and names session.rebound in the events description (R8)', () => {
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['ApiSessionRemoved', 'ApiSessionRebound'])
    )
    const rebound = doc.components.schemas['ApiSessionRebound']
    expect(rebound?.['required']).toEqual(['id', 'newId'])
    expect(rebound?.['additionalProperties']).toBe(false)
    const events = doc.paths['/v1/sessions/{id}/events']?.get as { description: string }
    expect(events.description).toContain('session.rebound')
  })

  it('publishes ONLY the error codes the server can emit', () => {
    const error = doc.components.schemas['ApiError']?.['properties'] as Record<
      string,
      { properties: Record<string, { enum?: string[] }> }
    >
    expect(error['error']?.properties['code']?.enum).toEqual([...API_ERROR_CODES])
  })

  it('emits no $schema keys (OpenAPI 3.1 schema objects must not carry one)', () => {
    expect(JSON.stringify(doc)).not.toContain('"$schema"')
  })
})
