// The bridge mod (spec 2026-10-18 §1.3): it reads what this session loaded and POSTs a
// paths-and-counts report to Claude Watcher. It never changes what claude does or shows: every
// hook hands `e` on untouched, and a failure is caught by `.catch(... next(e))`, which replays
// what `next` settled to (the engine's replay-safe `next`), so claude runs on as if it were absent.
// No command, tool, pane, status line or toast.
//
// When it sends (probe, claude 2.1.304): `prompt.context` gives the instruction files on the first
// prompt of each conversation, `/clear` included; `session.start` fires once per process, not
// after `/clear`. So the report goes out after each turn, and at start only once the files are
// known. Unchanged reports are not resent (`reportKey`).
import type { Engine, Register } from 'claude-code'
import { REPORT_SOURCES, buildReport, reportKey, type EngineData } from './report'

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

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await send($)
    return done
  }).catch((_$, e, next) => next(e))
}
