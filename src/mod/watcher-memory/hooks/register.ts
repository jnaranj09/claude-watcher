// The memory mod (memory phase 3, addendum §1). The rule, as both mod headers say it:
//
// `watcher-bridge` reads and reports. It never changes what claude does or shows.
// `watcher-memory` is the one mod that changes what claude reads, and only in a session the app
// started with `Memory` and `Memory recall` on, on claude 2.1.323 or newer. It does four things:
// (1) adds one `session` section, the memory index, last in the system prompt; (2) adds one
// context block beside an operator's prompt; (3) adds one context block after a Read, Edit, Write
// or NotebookEdit result in the main conversation; (4) serves `/remember`.
// It never rewrites or drops a prompt, a tool call, a tool result or another section. It never
// denies anything. It never breaks the prompt cache. It draws nothing (no pane, band, status line
// or toast) and registers no tool. When main is slow, down or says no, every hook hands on exactly
// what `next` gave. `tests/main/memoryModBounds.guard.test.ts` holds it to its seven events and
// keeps the banned calls out.
//
// Its one link is main's memory listener, read from the session's `--mcp-config` file. Every call
// races the mod's own timer (`WAIT_MS`): a fetch has no timeout of its own (probed: a main that
// answered after 6 s held the prompt 6 s), so the race is all that stands between a slow main and
// the operator's prompt. A miss, a throw or an answer other than 200 pauses every call but
// `/remember` for `PAUSE_MS`; nothing is retried. Time is read on `$.clock`, never `Date.now()`.
//
// The window: main keeps what it already told a session per window (P3-C16: a window that
// differs from the kept one resets those sets). The mod counts one more at each `/clear` and each
// compaction of the main conversation, so a fresh conversation gets the index and items again.
//
// Prompt text and memory text are SENSITIVE: nothing here logs, throws or writes either.
import type { Engine, Register } from 'claude-code'
import {
  FILE_TOOLS,
  MOD_PATHS,
  PAUSE_MS,
  REMEMBER_COMMAND,
  SECTION_ID,
  WAIT_MS,
  atUseBody,
  foldersFor,
  indexBody,
  nextWindow,
  parseConfig,
  readIndexAnswer,
  readRememberAnswer,
  readTextAnswer,
  recallBody,
  rememberBody,
  rememberRow,
  type Link
} from './protocol'

/** Where main listens and its header; unset = off (not the app's session, or no config). */
let link: Link | undefined
let window = 0
/** The index main gave for `window`, and the folders it holds keys for. */
let cached: { window: number; text: string; folders: string[] } | undefined
/** Folders already asked at use in this window (main had nothing more, or is being asked). */
const asked = new Set<string>()
/** Until this time (on `$.clock`) no call but `/remember` goes to main. */
let pausedUntil = 0

/** POSTs `body` to main's `path` and answers its text, or undefined: off, paused, or main did not
 *  answer 200 within `waitMs` (which starts the pause). */
async function ask(
  $: Engine,
  path: string,
  body: string,
  waitMs: number,
  ignorePause = false
): Promise<string | undefined> {
  if (link === undefined) return undefined
  if (!ignorePause && (await $.clock.now()) < pausedUntil) return undefined
  const res = await Promise.race([
    $.http
      .fetch(link.base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: link.authorization },
        body
      })
      .catch(() => undefined),
    $.clock.sleep(waitMs).then(
      () => undefined,
      () => undefined
    )
  ])
  if (res === undefined || res.status !== 200) {
    pausedUntil = (await $.clock.now()) + PAUSE_MS
    return undefined
  }
  return res.text
}

/** A new conversation window: main resets what it told, and every folder may be asked again. */
function newWindow(): void {
  window = nextWindow(window)
  asked.clear()
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The engine wants a literal name here (it lists what a mod reads); the bounds guard pins it
    // to the protocol's CONFIG_ENV.
    const path = await $.env.get('CLAUDE_WATCHER_MEMORY_CONFIG')
    if (path === undefined) return started
    link = parseConfig(await $.fs.read(path))
    if (link === undefined) return started
    // A literal name, as the matcher below has: only then does the engine read the `command.run`
    // hook as one that answers its own command (validate: "answers its own command"). The bounds
    // guard pins both to the protocol's REMEMBER_COMMAND.name.
    await $.command.register({
      name: 'remember',
      description: REMEMBER_COMMAND.description,
      argumentHint: REMEMBER_COMMAND.argumentHint
    })
    return started
  }).catch((_$, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (link === undefined) return composed
    if (cached?.window !== window) {
      const answer = readIndexAnswer(
        (await ask($, MOD_PATHS.index, indexBody(window), WAIT_MS.index)) ?? ''
      )
      if (answer !== undefined) cached = { window, ...answer }
    }
    if (cached === undefined || cached.text === '') return composed
    return {
      sections: [
        ...composed.sections,
        { id: SECTION_ID, text: cached.text, scope: 'session' as const }
      ]
    }
  }).catch((_$, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const body =
      link === undefined || e.command !== undefined || e.isMeta === true
        ? undefined
        : recallBody(window, e.origin?.kind ?? '', e.text ?? '')
    if (body === undefined) return next(e)
    const block = readTextAnswer((await ask($, MOD_PATHS.recall, body, WAIT_MS.recall)) ?? '')
    if (block === undefined) return next(e)
    return next({ ...e, context: [...(e.context ?? []), block] })
  }).catch((_$, e, next) => next(e))

  for (const tool of FILE_TOOLS) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (
        link === undefined ||
        e.agentId !== undefined ||
        ran.deny !== undefined ||
        ran.isError === true ||
        cached === undefined
      ) {
        return ran
      }
      const hits = foldersFor(e.file_path ?? e.notebook_path ?? '', cached.folders, asked)
      if (hits.length === 0) return ran
      for (const folder of hits) asked.add(folder)
      const res = await ask($, MOD_PATHS.atUse, atUseBody(window, hits), WAIT_MS.atUse).catch(
        () => undefined
      )
      if (res === undefined) {
        for (const folder of hits) asked.delete(folder)
        return ran
      }
      const block = readTextAnswer(res)
      if (block === undefined) return ran
      return { ...ran, context: [...(ran.context ?? []), block] }
    }).catch((_$, e, next) => next(e))
  }

  // Answers its own command (no `next`, so no `.catch`): `e.args` is the text as typed after
  // `/remember`; main refuses an origin other than the operator's (`-p` is `sdk`).
  on('command.run', { command: 'remember' }, async ($, e) => {
    if (link === undefined)
      return { text: rememberRow({ ok: false, code: 'memory_not_available' }) }
    const body = rememberBody(e.origin.kind, e.args)
    const answer = await ask($, MOD_PATHS.remember, body, WAIT_MS.remember, true)
    return { text: rememberRow(readRememberAnswer(answer ?? '')) }
  })

  on('session.compact', async (_$, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
      newWindow()
    }
    return done
  }).catch((_$, e, next) => next(e))

  on('session.end', (_$, e, next) => {
    if (e.reason === 'clear') newWindow()
    return next(e)
  }).catch((_$, e, next) => next(e))
}
