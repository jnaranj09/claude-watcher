// Fixture for raw-error-to-client.yaml (`semgrep --test`): `ruleid:` lines must match, `ok:` must not.
import type { ServerResponse } from 'node:http'

export function bad(res: ServerResponse, err: Error): void {
  // ruleid: raw-error-to-client
  res.end(JSON.stringify({ error: err.message }))
  // ruleid: raw-error-to-client
  res.write(`failed: ${err.stack}`)
}

export function good(res: ServerResponse): void {
  // ok: raw-error-to-client
  res.end(JSON.stringify({ error: { code: 'internal' } }))
}
