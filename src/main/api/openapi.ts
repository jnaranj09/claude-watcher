// Programmatic API — the OpenAPI 3.1 document, GENERATED from the same registry the router
// dispatches (`commands/index.ts`), so the docs cannot drift from the routes: a command with no
// operation is impossible, and an operation with no command cannot be written by hand.
//
// Schemas come from zod 4's `z.toJSONSchema` (draft 2020-12, which 3.1 accepts) with the `$schema`
// key stripped — a 3.1 Schema Object is a JSON Schema *dialect*, and a nested `$schema` is not part
// of that shape; strict validators reject it.
//
// TWO conversion rules, both load-bearing:
//   - a REQUEST schema (params, query, body) is converted with `io: 'input'`, so a field with a
//     `.default()` — `args` — is published OPTIONAL, which is what the server actually accepts.
//     `io: 'output'` (the default) publishes it REQUIRED and forces every generated client to send
//     a field it may omit.
//   - `.trim()` and `.refine()` do NOT survive the conversion (only the length bounds do). Where a
//     rule is lost, the property carries a DESCRIPTION saying so, rather than a document that
//     quietly promises less than the server enforces.
//
// The error table is the schema's own enum (`API_ERROR_CODES`), never a hand-kept list: a client
// switches on `error.code`, so a code in the document the server cannot emit is a lie, and one the
// server emits but the document omits is a surprise.
// [src/shared/schemas/api.ts; src/main/api/registry.ts]
import { z, type ZodType } from 'zod'
import {
  ApiErrorBodySchema,
  ApiSessionSchema,
  ApiTemplateSchema,
  ApiWorkspaceSchema,
  SessionsCreateBodySchema,
  SessionsCreateOutputSchema
} from '../../shared/schemas/api'
import { API_HOST } from './apiContract'
import type { AnyApiCommand } from './registry'

type Json = Record<string, unknown>

/** One conversion. `io` picks the direction (see the header); `$schema` is dropped. */
function jsonSchema(schema: ZodType, io: 'input' | 'output'): Json {
  const out = z.toJSONSchema(schema, { io }) as Json
  delete out['$schema']
  return out
}

/** The rules `SessionNameSchema` enforces that JSON Schema cannot carry: `.trim()` and the
 *  control-character `.refine()` both vanish in the conversion, leaving only 1..60. */
const NAME_RULES =
  'The card name shown on the board. 1–60 characters after trimming, and no control ' +
  'characters — the trim and the control-character check are enforced by the server but ' +
  'cannot be expressed in JSON Schema.'

interface NamedSchema {
  schema: ZodType
  name: string
  /** A request-side schema is `input`; a response-side one is `output`. */
  io: 'input' | 'output'
  /** Property → prose for a rule the conversion drops. */
  notes: Record<string, string>
}

/** Schemas hoisted into `components.schemas` by the IDENTITY of the zod object, so a command that
 *  uses `ApiSessionSchema` gets a `$ref` and a generated client gets ONE `ApiSession` type. */
const NAMED: readonly NamedSchema[] = [
  { schema: ApiSessionSchema, name: 'ApiSession', io: 'output', notes: {} },
  { schema: ApiErrorBodySchema, name: 'ApiError', io: 'output', notes: {} },
  {
    schema: SessionsCreateBodySchema,
    name: 'SessionsCreateBody',
    io: 'input',
    notes: { name: NAME_RULES }
  },
  { schema: SessionsCreateOutputSchema, name: 'SessionsCreateOutput', io: 'output', notes: {} },
  { schema: ApiWorkspaceSchema, name: 'ApiWorkspace', io: 'output', notes: {} },
  { schema: ApiTemplateSchema, name: 'ApiTemplate', io: 'output', notes: {} }
]

function nameOf(schema: ZodType): string | null {
  return NAMED.find((n) => n.schema === schema)?.name ?? null
}

function ref(name: string): Json {
  return { $ref: `#/components/schemas/${name}` }
}

/** A `$ref` for a hoisted schema (or an array of one), the inline conversion otherwise. */
function refOrInline(schema: ZodType, io: 'input' | 'output'): Json {
  const name = nameOf(schema)
  if (name !== null) return ref(name)
  // `z.array(ApiSessionSchema)` — the `GET /v1/sessions` output. The ARRAY is not hoisted (it has
  // no name of its own), but its item schema is, so the items reference it instead of inlining a
  // second copy of every session field.
  if (schema instanceof z.ZodArray) {
    const itemName = nameOf(schema.element as ZodType)
    if (itemName !== null) return { type: 'array', items: ref(itemName) }
  }
  return jsonSchema(schema, io)
}

/** Attach the prose for rules the conversion dropped. Mutates the freshly converted object — it is
 *  this function's own, never a cached one. */
function withNotes(js: Json, notes: Record<string, string>): Json {
  const props = js['properties']
  if (typeof props !== 'object' || props === null) return js
  for (const [key, text] of Object.entries(notes)) {
    const prop = (props as Record<string, unknown>)[key]
    if (typeof prop === 'object' && prop !== null) (prop as Json)['description'] = text
  }
  return js
}

/** Path + query params, flattened out of the command's own request schemas. A PATH param is always
 *  `required: true` (OpenAPI says so); a query param follows its schema. */
function parameters(command: AnyApiCommand): Json[] {
  const out: Json[] = []
  const slots: ReadonlyArray<['path' | 'query', ZodType]> = [
    ['path', command.params],
    ['query', command.query]
  ]
  for (const [where, schema] of slots) {
    const js = jsonSchema(schema, 'input')
    const props = (js['properties'] ?? {}) as Record<string, Json>
    const required = new Set((js['required'] ?? []) as string[])
    for (const [name, prop] of Object.entries(props)) {
      out.push({
        name,
        in: where,
        required: where === 'path' ? true : required.has(name),
        schema: prop
      })
    }
  }
  return out
}

/** Status → the operator-facing sentence. The CODE inside the body is the machine-readable part;
 *  this is only the response's label. */
const ERROR_TEXT: Record<number, string> = {
  400: 'Bad request',
  401: 'Missing or wrong bearer token',
  404: 'Not found',
  405: 'Method not allowed',
  500: 'Internal error',
  503: 'Not available',
  504: 'Timed out'
}

export function buildOpenApiDocument(
  commands: readonly AnyApiCommand[],
  info: { port: number; version: string }
): Json {
  const paths: Record<string, Json> = {}
  for (const c of commands) {
    const responses: Record<string, Json> = {}
    responses[String(c.successStatus)] =
      c.output === 'text/event-stream'
        ? {
            description: 'Server-sent events',
            content: { 'text/event-stream': { schema: { type: 'string' } } }
          }
        : {
            description: 'OK',
            content: { 'application/json': { schema: refOrInline(c.output, 'output') } }
          }
    for (const status of c.errorStatuses) {
      responses[String(status)] = {
        description: ERROR_TEXT[status] ?? 'Error',
        content: { 'application/json': { schema: ref('ApiError') } }
      }
    }
    const op: Json = {
      operationId: c.id,
      summary: c.summary,
      ...(c.description !== undefined ? { description: c.description } : {}),
      parameters: parameters(c),
      responses
    }
    if (c.body !== null) {
      op['requestBody'] = {
        required: true,
        content: { 'application/json': { schema: refOrInline(c.body, 'input') } }
      }
    }
    // MERGED, not assigned: `GET /v1/sessions` and `POST /v1/sessions` are two operations under
    // ONE path item, and assigning would drop whichever came first.
    paths[c.path] = { ...(paths[c.path] ?? {}), [c.method.toLowerCase()]: op }
  }

  const schemas: Record<string, Json> = {}
  for (const named of NAMED)
    schemas[named.name] = withNotes(jsonSchema(named.schema, named.io), named.notes)

  return {
    openapi: '3.1.0',
    info: {
      title: 'claude-watcher API',
      version: info.version,
      description: 'Local, token-protected control of the claude-watcher board.'
    },
    servers: [{ url: `http://${API_HOST}:${info.port}` }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas },
    paths
  }
}
