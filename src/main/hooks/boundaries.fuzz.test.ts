// Fuzz targets on the parsers at the outside boundaries (docs/threat-model.md T-C9, property tests
// with fast-check). Any input is parsed or refused with a 4xx / a failed `safeParse`; never a
// throw, a 5xx, a dropped connection or a hang.
//
// Seeds run in `npm test` with a small, fixed number of runs (FUZZ_RUNS unset). The weekly CI run
// (`.github/workflows/weekly.yml`) sets FUZZ_RUNS high. A failure prints fast-check's seed and the
// shrunk input: add that input as a plain test beside the fix.
import { describe, it, expect, afterEach } from 'vitest'
import { request } from 'node:http'
import fc from 'fast-check'
import { createHookServer } from './hookServer'
import { HookEventSchema } from '../../shared/schemas/hookEvent'
import { ModReportSchema } from '../../shared/schemas/modReport'
import { ModPromptSchema } from '../../shared/schemas/modPrompt'
import {
  ModMemoryAtUseSchema,
  ModMemoryIndexSchema,
  ModMemoryRecallSchema,
  ModMemoryRememberSchema
} from '../../shared/schemas/modMemory'
import { apiCommands } from '../api/commands'
import { makeFakeContext, startTestServer, TEST_TOKEN } from '../api/testSupport'

const RUNS = Number(process.env.FUZZ_RUNS ?? 200)
const TIMEOUT_MS = Math.max(30000, RUNS * 200)

const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

/** Bodies that look like what the boundaries expect, and bodies that do not. */
const KNOWN_KEYS = [
  'session_id',
  'hook_event_name',
  'notification_type',
  'tool_name',
  'tool_input',
  'last_assistant_message',
  'sessionId',
  'prompt',
  'origin',
  'templateId',
  'name',
  'args',
  'workspaceId'
]
const jsonish = fc.oneof(
  fc.jsonValue(),
  fc.dictionary(fc.constantFrom(...KNOWN_KEYS), fc.jsonValue(), { maxKeys: 8 }),
  fc.object({ maxDepth: 3 })
)
const body = fc.oneof(
  jsonish.map((v) => JSON.stringify(v) ?? 'null'),
  fc.string({ maxLength: 300 }),
  fc.string({ unit: 'binary', maxLength: 300 })
)

/** One request; resolves with the status, or rejects on a dropped connection or a hang. */
function send(
  url: string,
  method: string,
  path: string,
  payload: string,
  headers: Record<string, string> = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path,
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers
        },
        timeout: 5000
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('timeout', () => req.destroy(new Error(`no answer: ${method} ${path}`)))
    req.on('error', reject)
    req.end(payload)
  })
}

function startHooks(): Promise<string> {
  return new Promise((resolve) => {
    const srv = createHookServer({
      onHookEvent: () => {},
      log: () => {},
      port: 0,
      host: '127.0.0.1',
      onModReport: () => true,
      onModPrompt: () => true,
      onListening: (port) => resolve(`http://127.0.0.1:${port}`)
    })
    closers.push(() => srv.close())
  })
}

describe('fuzz: boundary schemas', () => {
  const schemas = {
    HookEventSchema,
    ModReportSchema,
    ModPromptSchema,
    ModMemoryIndexSchema,
    ModMemoryRecallSchema,
    ModMemoryAtUseSchema,
    ModMemoryRememberSchema
  }
  it.each(Object.entries(schemas))('%s.safeParse never throws on any JSON value', (_n, schema) => {
    fc.assert(
      fc.property(jsonish, (v) => {
        const r = schema.safeParse(v)
        expect(typeof r.success).toBe('boolean')
      }),
      { numRuns: RUNS * 5 }
    )
  })
})

describe('fuzz: the hook listener', () => {
  it(
    'any body to /, /mod/report or /mod/prompt answers 2xx or 4xx, and the server keeps serving',
    async () => {
      const url = await startHooks()
      await fc.assert(
        fc.asyncProperty(fc.constantFrom('/', '/mod/report', '/mod/prompt'), body, async (p, b) => {
          const status = await send(url, 'POST', p, b)
          expect(status >= 200 && status < 500, `${p} answered ${status}`).toBe(true)
        }),
        { numRuns: RUNS }
      )
      expect(await send(url, 'POST', '/', '{}')).toBe(400)
    },
    TIMEOUT_MS
  )
})

describe('fuzz: the API listener', () => {
  it(
    'any body or query to the real commands answers 2xx, 4xx or 503, never a 500',
    async () => {
      const { ctx } = makeFakeContext()
      const s = await startTestServer(apiCommands, ctx)
      closers.push(() => s.server.close())
      const paths = fc.oneof(
        fc.constantFrom('/v1/sessions', '/v1/workspaces', '/v1/templates'),
        fc.string({ maxLength: 40 }).map((x) => `/v1/sessions/${encodeURIComponent(x)}`),
        fc.string({ maxLength: 40 }).map((x) => `/v1/templates?scope=${encodeURIComponent(x)}`)
      )
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('GET', 'POST', 'DELETE'),
          paths,
          body,
          async (method, p, b) => {
            const status = await send(s.url, method, p, b, {
              authorization: `Bearer ${TEST_TOKEN}`
            })
            expect(status < 500 || status === 503, `${method} ${p} answered ${status}`).toBe(true)
          }
        ),
        { numRuns: RUNS }
      )
    },
    TIMEOUT_MS
  )
})
