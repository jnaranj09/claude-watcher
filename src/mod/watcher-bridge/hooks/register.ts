// The bridge mod (spec 2026-10-18 §1.3): it reads what this session loaded and POSTs a
// paths-and-counts report to Claude Watcher, and after each prompt it POSTs who sent it
// (`prompt.submit`'s `origin.kind`, never the text; spec 2026-10-23). It never changes what
// claude does or shows: every hook hands `e` on untouched and returns what `next` gave, and a
// failure is caught by `.catch(... next(e))`, which replays what `next` settled to (the engine's
// replay-safe `next`), so claude runs on as if it were absent. No command, tool, pane, status line
// or toast.
//
// When it sends (probe, claude 2.1.304): `prompt.context` gives the instruction files on the first
// prompt of each conversation, `/clear` included; `session.start` fires once per process, not
// after `/clear`. So the report goes out after each turn, and at start only once the files are
// known. Unchanged reports are not resent (`reportKey`).
//
// The origin goes out once `next(e)` has settled, which is after claude's http `UserPromptSubmit`
// hook was answered (probe, claude 2.1.309), so the app always sees the hook first. A 409 (no live
// session) or a failed send is not retried: the next prompt sends its own. A prompt with no origin
// (origin probed on 2.1.309; `prompt.submit` is in the 2.1.307–2.1.309 binaries, 2.1.304–2.1.306
// unverified, so an older claude may give none) sends nothing: the app then keeps clearing an ask on
// `UserPromptSubmit`, where a reported non-operator origin would stop that for good.
import type { Engine, Register } from 'claude-code'
import { REPORT_SOURCES, buildReport, reportKey, type EngineData } from './report'
import { buildPrompt, promptUrl } from './prompt'

/** Set by the app on the spawn; unset means a session the app did not launch: do nothing. */
let url: string | undefined
let files: EngineData['instructionFiles'] | undefined
let lastSent: string | undefined

async function send($: Engine): Promise<void> {
  if (url === undefined || files === undefined) return
  const sessionId = await $.session.id()
  const usage = await $.session.usage({ breakdown: 'summary' })
  const settings: EngineData['settings'] = {}
  for (const source of REPORT_SOURCES) settings[source] = await $.settings.read({ source })
  const report = buildReport(
    { instructionFiles: files, breakdown: usage.context.breakdown, settings },
    sessionId
  )
  const key = reportKey(report)
  if (key === lastSent) return
  const res = await $.http.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report)
  })
  if (res.ok) lastSent = key
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    url = await $.env.get('CLAUDE_WATCHER_MOD_URL')
    await send($)
    return started
  }).catch((_$, e, next) => next(e))

  on('prompt.context', (_$, e, next) => {
    if (e.instructionFiles !== undefined) {
      files = e.instructionFiles.map((f) => ({
        path: f.path,
        kind: f.kind,
        ...(f.parent !== undefined ? { parent: f.parent } : {})
      }))
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    const target = url === undefined ? undefined : promptUrl(url)
    if (target === undefined) return entered
    const body = buildPrompt(await $.session.id(), e.origin)
    if (body === undefined) return entered
    await $.http.fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    return entered
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await send($)
    return done
  }).catch((_$, e, next) => next(e))
}
