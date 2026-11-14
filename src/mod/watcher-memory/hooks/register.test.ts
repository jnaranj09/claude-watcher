// Engine test for the memory mod, run by `claude plugin test` (npm run test:mod, local only). The
// test's own hooks sit beneath the mod and stand for the engine and for main: they answer the
// calls the mod makes, record each request it sends (where, what, which header) and what claude
// was handed. `mock.clock` holds every wait, so a slow main is a fetch that answers on the clock.
// The pure protocol (bodies, readers, rows) is unit-tested in tests/unit/memoryModProtocol.test.ts.
import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

const CONFIG_PATH = '/run/cw/memory-mcp.json'
const BASE = 'http://127.0.0.1:29279'
const TOKEN = 'Bearer tok-SECRET'
const CONFIG_TEXT = JSON.stringify({
  mcpServers: {
    'claude-watcher-memory': {
      type: 'http',
      url: `${BASE}/mcp/memory`,
      headers: { Authorization: TOKEN }
    }
  }
})
const ENV = { CLAUDE_WATCHER_MEMORY_CONFIG: CONFIG_PATH }
const INDEX = 'Memory (Claude Watcher): the index'
const RECALL = 'Memory (Claude Watcher): staging port 8443'
const KEYS = 'Memory (Claude Watcher): keys for /work/app'
const CORE = { id: 'intro', text: 'core text', scope: 'shared' } as const
const SECTION = { id: 'watcher-memory:index', text: INDEX, scope: 'session' } as const
const PROMPT = 'what is the SECRET staging port'
const START = { cwd: '/work/app', surface: null, isInteractive: true }
const COMPOSE = {
  model: 'm',
  promptModel: 'm',
  surfaces: [],
  tools: [],
  outputStyle: null,
  traits: []
}
const PRESENTATION = { isFullscreen: false, columns: 80 }
const MESSAGES = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

type Sent = { url: string; body: string; authorization: string | undefined }
type Answer = { status: number; text: string }
type Main = (path: string, body: string, clock: ReturnType<typeof mock.clock>) => Promise<Answer>

const ANSWERS: Record<string, string> = {
  '/mod/memory/index': JSON.stringify({ ok: true, text: INDEX, folders: ['/work/app'] }),
  '/mod/memory/recall': JSON.stringify({ ok: true, text: RECALL }),
  '/mod/memory/at-use': JSON.stringify({ ok: true, text: KEYS }),
  '/mod/memory/remember': JSON.stringify({ ok: true, kind: 'fact', id: 'm1' })
}

/** A main that answers every route at once, well. */
const WELL: Main = async (path) => ({ status: 200, text: ANSWERS[path] ?? '' })

/** A main that never answers in any time the test reaches. */
const NEVER: Main = async (_path, _body, clock) => {
  await clock.sleep(10_000_000)
  return { status: 200, text: '' }
}

/** What the engine beneath answers, where a test needs other than the usual. */
type Beneath = {
  config?: string
  tool?: { deny: string } | { isError: true; result: string; text: string }
  compact?: { skip: string }
}

function world(
  on: On,
  env: Record<string, string>,
  main: Main = WELL,
  beneath: Beneath = {}
): {
  sent: Sent[]
  registered: unknown[]
  submitted: unknown[]
  clock: ReturnType<typeof mock.clock>
} {
  const sent: Sent[] = []
  const registered: unknown[] = []
  const submitted: unknown[] = []
  const clock = mock.clock(on)
  mock.env(on, env)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('fs.read', (_$, e) => ({
    value: e.path === CONFIG_PATH ? (beneath.config ?? CONFIG_TEXT) : ''
  }))
  on('command.register', (_$, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('prompt.compose', () => ({ sections: [CORE] }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e)
    return { text: e.text, ...(e.context !== undefined ? { context: e.context } : {}) }
  })
  on('tool.call', () => beneath.tool ?? { result: 'file text', text: 'file text' })
  on('session.compact', () => beneath.compact ?? { messages: MESSAGES })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('http.fetch', async (_$, e) => {
    const body = typeof e.init?.body === 'string' ? e.init.body : ''
    sent.push({ url: e.url, body, authorization: e.init?.headers?.authorization })
    const answer = await main(e.url.slice(BASE.length), body, clock)
    return {
      value: { status: answer.status, ok: answer.status === 200, headers: {}, text: answer.text }
    }
  })
  return { sent, registered, submitted, clock }
}

const END_CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const
const remember = (args: string, kind: 'composer' | 'sdk') => ({
  command: 'remember',
  args,
  origin: { kind },
  presentation: PRESENTATION
})
const index = (window: number): Sent => ({
  url: `${BASE}/mod/memory/index`,
  body: JSON.stringify({ version: 1, window }),
  authorization: TOKEN
})

test('with no config env the mod adds nothing and registers no command', async ($, on) => {
  const { sent, registered, submitted } = world(on, {})
  await $.session.start(START)
  const composed = await $.prompt.compose(COMPOSE)
  await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'composer' } })
  expect([composed, submitted, registered, sent]).toEqual([
    { sections: [CORE] },
    [{ text: PROMPT, wait: false, origin: { kind: 'composer' } }],
    [],
    []
  ])
})

test('adds the index as the last session section', async ($, on) => {
  const { sent, registered } = world(on, ENV)
  await $.session.start(START)
  const composed = await $.prompt.compose(COMPOSE)
  expect([composed, sent, registered]).toEqual([
    { sections: [CORE, SECTION] },
    [index(0)],
    [
      {
        name: 'remember',
        description: "Save a line to this app's memory. No model turn.",
        argumentHint: '<text> | <key> = <value>'
      }
    ]
  ])
})

test('a second compose in the same window asks nothing and answers the same text', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  const first = await $.prompt.compose(COMPOSE)
  const second = await $.prompt.compose(COMPOSE)
  expect([first, second, sent]).toEqual([
    { sections: [CORE, SECTION] },
    { sections: [CORE, SECTION] },
    [index(0)]
  ])
})

test('after /clear the next compose asks again with window 1', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.session.end(END_CLEAR)
  const composed = await $.prompt.compose(COMPOSE)
  expect([composed, sent]).toEqual([{ sections: [CORE, SECTION] }, [index(0), index(1)]])
})

test("after a compaction of the main conversation the window is 2; a subagent's compaction changes nothing", async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MESSAGES })
  await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
  await $.session.compact({ trigger: 'auto', messages: MESSAGES })
  await $.prompt.compose(COMPOSE)
  expect(sent).toEqual([index(2)])
})

test("a recall block rides the prompt's context after what was already there", async ($, on) => {
  const { sent, submitted } = world(on, ENV)
  await $.session.start(START)
  const entered = await $.prompt.submit({
    text: PROMPT,
    wait: false,
    origin: { kind: 'composer' },
    context: ['earlier']
  })
  expect([entered, submitted, sent]).toEqual([
    { text: PROMPT, context: ['earlier', RECALL] },
    [{ text: PROMPT, wait: false, origin: { kind: 'composer' }, context: ['earlier', RECALL] }],
    [
      {
        url: `${BASE}/mod/memory/recall`,
        body: JSON.stringify({ version: 1, window: 0, origin: 'composer', text: PROMPT }),
        authorization: TOKEN
      }
    ]
  ])
})

test('a command prompt and a meta prompt ask nothing', async ($, on) => {
  const { sent, submitted } = world(on, ENV)
  await $.session.start(START)
  const command = {
    text: '/review now',
    wait: false,
    origin: { kind: 'composer' },
    command: { name: 'review', args: 'now' }
  } as const
  const meta = { text: PROMPT, wait: false, origin: { kind: 'composer' }, isMeta: true } as const
  await $.prompt.submit(command)
  await $.prompt.submit(meta)
  expect([submitted, sent]).toEqual([[command, meta], []])
})

test('a main that never answers does not hold the prompt past 250 ms, and the next prompt asks nothing for 30 s', async ($, on) => {
  const { sent, submitted, clock } = world(on, ENV, NEVER)
  await $.session.start(START)
  const plain = { text: PROMPT, wait: false, origin: { kind: 'composer' } } as const
  const first = $.prompt.submit(plain)
  await clock.settle()
  await clock.advance(250)
  await first
  await $.prompt.submit(plain)
  const askedInPause = sent.length
  await clock.advance(30_000)
  const third = $.prompt.submit(plain)
  await clock.settle()
  const askedAfter = sent.length
  await clock.advance(250)
  await third
  expect([submitted, askedInPause, askedAfter]).toEqual([[plain, plain, plain], 1, 2])
})

test('a main that never answers the index leaves the compose answer as next gave it after 500 ms', async ($, on) => {
  const { sent, clock } = world(on, ENV, NEVER)
  await $.session.start(START)
  const composing = $.prompt.compose(COMPOSE)
  await clock.settle()
  await clock.advance(500)
  expect([await composing, sent]).toEqual([{ sections: [CORE] }, [index(0)]])
})

const atUse = (window: number): Sent => ({
  url: `${BASE}/mod/memory/at-use`,
  body: JSON.stringify({ version: 1, window, folders: ['/work/app'] }),
  authorization: TOKEN
})
const AT_USE = atUse(0)
/** What the tool beneath answers a file tool, as the mod must hand it on when it adds nothing. */
const RAN = { result: 'file text', text: 'file text' }

test('a Read under a listed folder gets the block once', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const first = await $.tool.call({ tool: 'Read', file_path: '/work/app/src/a.ts' })
  const second = await $.tool.call({ tool: 'Read', file_path: '/work/app/src/b.ts' })
  expect([first, second, sent]).toEqual([
    { result: 'file text', text: 'file text', context: [KEYS] },
    RAN,
    [index(0), AT_USE]
  ])
})

test('two Reads under one folder that run at once ask main once', async ($, on) => {
  const late: Main = async (path, body, clock) => {
    await clock.sleep(path === '/mod/memory/at-use' ? 100 : 0)
    return WELL(path, body, clock)
  }
  const { sent, clock } = world(on, ENV, late)
  await $.session.start(START)
  const composing = $.prompt.compose(COMPOSE)
  await clock.settle()
  await composing
  const both = Promise.all([
    $.tool.call({ tool: 'Read', file_path: '/work/app/src/a.ts' }),
    $.tool.call({
      tool: 'Edit',
      file_path: '/work/app/src/b.ts',
      old_string: 'a',
      new_string: 'b'
    })
  ])
  await clock.settle()
  await clock.advance(100)
  await both
  expect(sent).toEqual([index(0), AT_USE])
})

test("a subagent's Read asks nothing", async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/work/app/src/a.ts', agentId: 'a1' })
  expect([ran, sent]).toEqual([RAN, [index(0)]])
})

test('a failed at-use call leaves the folder to be asked again, an empty answer does not', async ($, on) => {
  const atUse: Answer[] = [
    { status: 500, text: '' },
    { status: 200, text: JSON.stringify({ ok: true, text: '' }) }
  ]
  const main: Main = async (path, body, clock) =>
    path === '/mod/memory/at-use'
      ? (atUse.shift() ?? { status: 200, text: ANSWERS[path] ?? '' })
      : WELL(path, body, clock)
  const { sent, clock } = world(on, ENV, main)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  await clock.advance(30_000)
  await $.tool.call({ tool: 'Write', file_path: '/work/app/b.ts', content: 'b' })
  await $.tool.call({
    tool: 'NotebookEdit',
    notebook_path: '/work/app/c.ipynb',
    new_source: 'c'
  })
  expect(sent).toEqual([index(0), AT_USE, AT_USE])
})

test('/remember sends e.args and e.origin.kind, and a non-composer origin gets the not-the-operator row', async ($, on) => {
  const main: Main = async () => ({
    status: 200,
    text: JSON.stringify({ ok: false, code: 'remember_not_operator' })
  })
  const { sent } = world(on, ENV, main)
  await $.session.start(START)
  const ran = await $.command.run(remember('deploy key = abc', 'sdk'))
  expect([ran, sent]).toEqual([
    { text: 'Only you can use /remember.' },
    [
      {
        url: `${BASE}/mod/memory/remember`,
        body: JSON.stringify({ version: 1, origin: 'sdk', text: 'deploy key = abc' }),
        authorization: TOKEN
      }
    ]
  ])
})

test('/remember sends the text with the bearer and prints the row', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  const ran = await $.command.run(remember('staging port = 8443', 'composer'))
  expect([ran, sent]).toEqual([
    { text: 'Saved as a fact. id=m1' },
    [
      {
        url: `${BASE}/mod/memory/remember`,
        body: JSON.stringify({ version: 1, origin: 'composer', text: 'staging port = 8443' }),
        authorization: TOKEN
      }
    ]
  ])
})

test('/remember still asks during a pause', async ($, on) => {
  const main: Main = async (path, body, clock) =>
    path === '/mod/memory/recall' ? { status: 500, text: '' } : WELL(path, body, clock)
  const { sent } = world(on, ENV, main)
  await $.session.start(START)
  await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'composer' } })
  const ran = await $.command.run(remember('staging port = 8443', 'composer'))
  expect([ran, sent.map((s) => s.url)]).toEqual([
    { text: 'Saved as a fact. id=m1' },
    [`${BASE}/mod/memory/recall`, `${BASE}/mod/memory/remember`]
  ])
})

test('/remember with no answer in 3,000 ms prints the did-not-answer row', async ($, on) => {
  const { sent, clock } = world(on, ENV, NEVER)
  await $.session.start(START)
  const running = $.command.run(remember('staging port = 8443', 'composer'))
  await clock.settle()
  await clock.advance(3000)
  expect([await running, sent.length]).toEqual([
    { text: 'Memory did not answer. The line may not be saved.' },
    1
  ])
})

test('no request URL holds a query string, the prompt text or the token', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  await $.command.run(remember('SECRET = 1', 'composer'))
  expect(sent.map((s) => s.url)).toEqual([
    `${BASE}/mod/memory/index`,
    `${BASE}/mod/memory/recall`,
    `${BASE}/mod/memory/at-use`,
    `${BASE}/mod/memory/remember`
  ])
  expect(sent.filter((s) => /[?#]|SECRET|tok-/.test(s.url))).toEqual([])
})

test('a config file the mod cannot read leaves it off: no section, no command, no request', async ($, on) => {
  const { sent, registered } = world(on, ENV, WELL, { config: 'not json' })
  await $.session.start(START)
  const composed = await $.prompt.compose(COMPOSE)
  expect([composed, registered, sent]).toEqual([{ sections: [CORE] }, [], []])
})

test('/remember in a session with no link prints the not-available row and asks nothing', async ($, on) => {
  const { sent } = world(on, {})
  await $.session.start(START)
  const ran = await $.command.run(remember('staging port = 8443', 'composer'))
  expect([ran, sent]).toEqual([{ text: 'Memory is not available.' }, []])
})

test('a Read the tool refused asks nothing and hands on the refusal', async ($, on) => {
  const { sent } = world(on, ENV, WELL, { tool: { deny: 'not here' } })
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect([ran, sent]).toEqual([{ deny: 'not here' }, [index(0)]])
})

test('a Read that failed asks nothing and hands on the error', async ($, on) => {
  const failed = { isError: true, result: 'no such file', text: 'no such file' } as const
  const { sent } = world(on, ENV, WELL, { tool: failed })
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect([ran, sent]).toEqual([failed, [index(0)]])
})

test('a compaction that was skipped keeps the window', async ($, on) => {
  const { sent } = world(on, ENV, WELL, { compact: { skip: 'not now' } })
  await $.session.start(START)
  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  await $.prompt.compose(COMPOSE)
  expect(sent).toEqual([index(0)])
})

/** A main whose index route answers each of `answers` in turn (then well), every other route well. */
function indexInTurn(answers: Answer[]): Main {
  return async (path, body, clock) =>
    path === '/mod/memory/index'
      ? (answers.shift() ?? WELL(path, body, clock))
      : WELL(path, body, clock)
}
const GOOD_INDEX = { status: 200, text: ANSWERS['/mod/memory/index'] ?? '' }
const MEMORY_OFF = { status: 200, text: JSON.stringify({ ok: false }) }
const recall = (window: number, origin: string): Sent => ({
  url: `${BASE}/mod/memory/recall`,
  body: JSON.stringify({ version: 1, window, origin, text: PROMPT }),
  authorization: TOKEN
})

test('a tool that is not a file tool asks nothing, even with a path under a listed folder', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'mcp__files__open', file_path: '/work/app/a.ts' })
  expect([ran, sent]).toEqual([RAN, [index(0)]])
})

test('an empty index adds no section', async ($, on) => {
  const empty = {
    status: 200,
    text: JSON.stringify({ ok: true, text: '', folders: ['/work/app'] })
  }
  const { sent } = world(on, ENV, indexInTurn([empty]))
  await $.session.start(START)
  const composed = await $.prompt.compose(COMPOSE)
  expect([composed, sent]).toEqual([{ sections: [CORE] }, [index(0)]])
})

test('after /clear a folder already asked is asked again, with the new window', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  await $.session.end(END_CLEAR)
  await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect([ran, sent]).toEqual([
    { ...RAN, context: [KEYS] },
    [index(0), atUse(0), index(1), atUse(1)]
  ])
})

test('after a compaction a folder already asked is asked again, with the new window', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  await $.session.compact({ trigger: 'auto', messages: MESSAGES })
  await $.prompt.compose(COMPOSE)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect(sent).toEqual([index(0), atUse(0), index(1), atUse(1)])
})

test('after /clear a recall carries the new window', async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.session.end(END_CLEAR)
  await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'composer' } })
  expect(sent).toEqual([recall(1, 'composer')])
})

test("a prompt's origin is sent as it came, and a prompt with no origin is sent with ''", async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'sdk' } })
  await $.prompt.submit({ text: PROMPT, wait: false } as Parameters<typeof $.prompt.submit>[0])
  expect(sent).toEqual([recall(0, 'sdk'), recall(0, '')])
})

test('session.start, session.compact and session.end hand on exactly what next gave', async ($, on) => {
  world(on, ENV)
  const started = await $.session.start(START)
  const compacted = await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  const ended = await $.session.end(END_CLEAR)
  expect([started, compacted, ended]).toEqual([
    { cwd: '/work/app' },
    { messages: MESSAGES },
    { sessionId: 's1' }
  ])
})

test('a fetch that throws starts the pause', async ($, on) => {
  const refused: Main = async () => {
    throw new Error('connection refused')
  }
  const { sent, submitted, clock } = world(on, ENV, refused)
  await $.session.start(START)
  const plain = { text: PROMPT, wait: false, origin: { kind: 'composer' } } as const
  await $.prompt.submit(plain)
  await $.prompt.submit(plain)
  const askedInPause = sent.length
  await clock.advance(30_000)
  await $.prompt.submit(plain)
  expect([submitted, askedInPause, sent.length]).toEqual([[plain, plain, plain], 1, 2])
})

test('Memory off after /clear: the index main refuses drops the old one, so no section and no folder ask', async ($, on) => {
  const { sent } = world(on, ENV, indexInTurn([GOOD_INDEX, MEMORY_OFF]))
  await $.session.start(START)
  const before = await $.prompt.compose(COMPOSE)
  await $.session.end(END_CLEAR)
  const after = await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect([before, after, ran, sent]).toEqual([
    { sections: [CORE, SECTION] },
    { sections: [CORE] },
    RAN,
    [index(0), index(1)]
  ])
})

test('Memory off after a compaction: the index main refuses drops the old one', async ($, on) => {
  const { sent } = world(on, ENV, indexInTurn([GOOD_INDEX, MEMORY_OFF]))
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.session.compact({ trigger: 'auto', messages: MESSAGES })
  const after = await $.prompt.compose(COMPOSE)
  expect([after, sent]).toEqual([{ sections: [CORE] }, [index(0), index(1)]])
})

test('an index ask that fails with a non-200 keeps the last good index', async ($, on) => {
  const { sent } = world(on, ENV, indexInTurn([GOOD_INDEX, { status: 500, text: '' }]))
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.session.end(END_CLEAR)
  const after = await $.prompt.compose(COMPOSE)
  expect([after, sent]).toEqual([{ sections: [CORE, SECTION] }, [index(0), index(1)]])
})

test('an index answer that is not JSON keeps the last good index', async ($, on) => {
  const { sent } = world(on, ENV, indexInTurn([GOOD_INDEX, { status: 200, text: '<html>' }]))
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  await $.session.end(END_CLEAR)
  const after = await $.prompt.compose(COMPOSE)
  expect([after, sent]).toEqual([{ sections: [CORE, SECTION] }, [index(0), index(1)]])
})

test("a /context render asks nothing and leaves the window's ask to the next request", async ($, on) => {
  const { sent } = world(on, ENV)
  await $.session.start(START)
  const measured = await $.prompt.compose({ ...COMPOSE, traits: ['analysis'] })
  const asked = sent.length
  const composed = await $.prompt.compose(COMPOSE)
  expect([measured, asked, composed, sent]).toEqual([
    { sections: [CORE] },
    0,
    { sections: [CORE, SECTION] },
    [index(0)]
  ])
})

test('while Memory is off the later composes of the same window ask nothing', async ($, on) => {
  const { sent } = world(on, ENV, indexInTurn([MEMORY_OFF]))
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const again = await $.prompt.compose(COMPOSE)
  expect([again, sent]).toEqual([{ sections: [CORE] }, [index(0)]])
})

test('when Memory comes back mid-window no section is added until the next window', async ($, on) => {
  const { sent } = world(on, ENV, indexInTurn([MEMORY_OFF, GOOD_INDEX, GOOD_INDEX]))
  await $.session.start(START)
  await $.prompt.compose(COMPOSE)
  const sameWindow = await $.prompt.compose(COMPOSE)
  await $.session.end(END_CLEAR)
  const nextWindow = await $.prompt.compose(COMPOSE)
  expect([sameWindow, nextWindow, sent]).toEqual([
    { sections: [CORE] },
    { sections: [CORE, SECTION] },
    [index(0), index(1)]
  ])
})
