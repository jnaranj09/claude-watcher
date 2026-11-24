// Fixture for log-parsed-input.yaml (`semgrep --test`): `ruleid:` lines must match, `ok:` must not.
declare const log: (line: string) => void
declare const options: { log: (line: string) => void }

export function bad(req: { body: unknown }, err: Error, parsed: unknown): void {
  // ruleid: log-parsed-input
  console.warn('bad body', req.body)
  // ruleid: log-parsed-input
  log(`[x] failed: ${err.message}`)
  // ruleid: log-parsed-input
  options.log(`[x] value=${JSON.stringify(parsed)}`)
}

export function good(path: string, code: string): void {
  // ok: log-parsed-input
  console.warn(`[x] dropped path=${path} code=${code}`)
  // ok: log-parsed-input
  log('[x] code=response_error')
}
