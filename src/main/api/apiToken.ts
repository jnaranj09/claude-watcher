// Programmatic API — the bearer token, in its own 0600 file inside the app's data dir. Never in
// settings.json (the renderer reads that blob) and NEVER logged.
//
// The token is the whole authorization story for the local HTTP API, so three things are
// load-bearing here:
//   - 32 random bytes as 64 hex chars — unguessable, and a shape a regex can check exactly;
//   - mode 0600 — another user on the box can list the file but not read it. Forced on EVERY
//     read, not just on create, because `writeFileSync`'s `mode` does nothing to a file that
//     already exists;
//   - a file that is not EXACTLY 64 hex chars is replaced, never trusted. A truncated or
//     hand-edited file would otherwise become a weak token the operator cannot see is weak.
//
// The two write paths fail DIFFERENTLY, on purpose. The FIRST MINT is fail-soft (never-crash):
// the token stays in memory so the API still serves this run, and the next start mints a fresh
// one. REGENERATE throws: it is a revocation, and a revocation that never reached the disk comes
// undone at the next start — handing back a token that exists only in this process would tell the
// operator a lie. Either way the log is a `code=` ONLY — the path leaks the operator's filesystem
// layout, and the value IS the secret.
// [.claude/rules/zod-boundaries.md never-log-the-value; CLAUDE.md `[claude-watcher]` prefix]
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The token file inside the app's OWN data dir (`app.getPath('userData')`). */
export const API_TOKEN_FILENAME = 'claude-watcher-api-token'

/** The only shape a persisted token may have: 32 random bytes, lowercase hex. */
const TOKEN_RE = /^[0-9a-f]{64}$/

export interface ApiTokenStore {
  /** The current token; mints + persists one when the file is missing or malformed. */
  current(): string
  /**
   * Mint a new token, persist it, return it.
   *
   * THROWS `Error('token_write_failed')` when the write fails, keeping the PREVIOUS token in
   * memory. Regenerating is a revocation, and a revocation that did not reach the disk is one
   * the next start undoes — so the caller (the IPC handler, and the Settings panel behind it)
   * must hear about it rather than be handed a token that only exists in this process.
   */
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

  /** Write the token 0600. Returns false (and logs a code) when it could not be persisted. */
  function persist(token: string): boolean {
    try {
      mkdirSync(options.dir, { recursive: true })
      writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 })
      return true
    } catch {
      // Code only — the token is the secret and the path is the operator's filesystem layout.
      log('[claude-watcher][api] code=token_write_failed')
      return false
    }
  }

  /**
   * Force 0600 on a file we did not create.
   *
   * `writeFileSync`'s `mode` applies only on CREATE, so a token file that already exists with a
   * looser mode — a restored backup, a hand copy, a build predating the 0600 write — would keep
   * it forever while we happily read it. Fail-soft: a chmod we cannot do is logged and does not
   * stop the read; refusing to start over a mode bit would be worse than the loose mode.
   */
  function tighten(): void {
    try {
      chmodSync(path, 0o600)
    } catch {
      log('[claude-watcher][api] code=token_chmod_failed')
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
      tighten()
      cached = onDisk
      return cached
    }
    // FIRST MINT is fail-soft on purpose: an unwritable data dir must not stop the API from
    // serving this run. The operator can still copy the token; the next start mints a fresh one.
    cached = randomHex()
    persist(cached)
    return cached
  }

  function regenerate(): string {
    const minted = randomHex()
    if (!persist(minted)) {
      // KEEP the previous token: a `current()` after this still returns what the disk holds, so
      // memory and disk do not disagree about which token is live.
      throw new Error('token_write_failed')
    }
    cached = minted
    return cached
  }

  return { current, regenerate }
}
