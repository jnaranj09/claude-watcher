// Programmatic API — the bearer token, in its own 0600 file inside the app's data dir. Never in
// settings.json (the renderer reads that blob) and NEVER logged.
//
// The token is the whole authorization story for the local HTTP API, so three things are
// load-bearing here:
//   - 32 random bytes as 64 hex chars — unguessable, and a shape a regex can check exactly;
//   - mode 0600 — another user on the box can list the file but not read it;
//   - a file that is not EXACTLY 64 hex chars is replaced, never trusted. A truncated or
//     hand-edited file would otherwise become a weak token the operator cannot see is weak.
//
// A write failure is FAIL-SOFT (never-crash): the minted token stays in memory, so the API still
// works for this run and the operator can copy it; the next start mints a fresh one. The log is a
// `code=` ONLY — the path leaks the operator's filesystem layout, and the value IS the secret.
// [.claude/rules/zod-boundaries.md never-log-the-value; CLAUDE.md `[claude-watcher]` prefix]
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The token file inside the app's OWN data dir (`app.getPath('userData')`). */
export const API_TOKEN_FILENAME = 'claude-watcher-api-token'

/** The only shape a persisted token may have: 32 random bytes, lowercase hex. */
const TOKEN_RE = /^[0-9a-f]{64}$/

export interface ApiTokenStore {
  /** The current token; mints + persists one when the file is missing or malformed. */
  current(): string
  /** Mint a new token, persist it, return it. */
  regenerate(): string
}

export interface ApiTokenStoreOptions {
  /** `app.getPath('userData')`. */
  dir: string
  /** Diagnostics sink. Receives a `code=` string ONLY — never the token. Defaults to console.warn. */
  log?: (message: string) => void
  /** Injected for determinism; defaults to 32 random bytes as hex. */
  randomHex?: () => string
}

export function createApiTokenStore(options: ApiTokenStoreOptions): ApiTokenStore {
  const log = options.log ?? ((message: string): void => console.warn(message))
  const randomHex = options.randomHex ?? ((): string => randomBytes(32).toString('hex'))
  const path = join(options.dir, API_TOKEN_FILENAME)
  let cached: string | null = null

  function persist(token: string): void {
    try {
      mkdirSync(options.dir, { recursive: true })
      writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Never-crash: the caller keeps the in-memory token. Code only — the token is the secret
      // and the path is the operator's filesystem layout.
      log('[claude-watcher][api] code=token_write_failed')
    }
  }

  function current(): string {
    if (cached !== null) return cached
    let onDisk: string | null = null
    try {
      onDisk = readFileSync(path, 'utf8').trim()
    } catch {
      onDisk = null // missing / unreadable — fall through to minting
    }
    if (onDisk !== null && TOKEN_RE.test(onDisk)) {
      cached = onDisk
      return cached
    }
    cached = randomHex()
    persist(cached)
    return cached
  }

  function regenerate(): string {
    cached = randomHex()
    persist(cached)
    return cached
  }

  return { current, regenerate }
}
