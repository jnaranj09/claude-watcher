// A hook POST to the e2e profile's hook listener, the way claude sends one: at the session's own
// channel path (`/h/<token>/`, read with `hookPathOf` in ./proc.ts). Used by the acceptance
// scenarios (tests/acceptance/); native-engine.e2e.ts still holds its own copy.

import http from 'node:http'
import path from 'node:path'
import { E2E_PROFILE } from '../../../src/main/profile'

/** POST one hook body; resolves with the HTTP status (200 accepted, 400 dropped, 401 no token). */
export function postHook(hookPath: string, body: Record<string, unknown>): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request(
      {
        host: '127.0.0.1',
        port: E2E_PROFILE.hookPort,
        method: 'POST',
        path: hookPath,
        headers: { 'content-type': 'application/json', 'content-length': payload.length }
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** The fields every hook body carries (claude 2.1.199 shape, src/__fixtures__/fakeHookFeed.ts).
 *  The transcript path sits in the picked folder, so a spec can create it there. */
export function hookCommon(sessionId: string, pickDir: string): Record<string, string> {
  return {
    session_id: sessionId,
    transcript_path: path.join(pickDir, `${sessionId}.jsonl`),
    cwd: pickDir
  }
}
