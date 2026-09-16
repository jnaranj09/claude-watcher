// Programmatic API — the bearer token store.
//
// What these tests protect: the token is the ONLY thing standing between a local HTTP caller
// and the ability to launch sessions, so (a) it must be unguessable and unreadable by other
// users (64 hex chars in an 0600 file), (b) a file that is not exactly that shape is never
// trusted, and (c) no failure path may ever put the token in a log line.
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiTokenStore, API_TOKEN_FILENAME } from './apiToken'

const dir = (): string => mkdtempSync(join(tmpdir(), 'cw-token-'))

/**
 * A directory path that can never be created or written: its PARENT is a regular file, so
 * both `mkdirSync(..., { recursive: true })` and the write fail with ENOTDIR.
 *
 * Deliberately inside the OS temp dir rather than a system path like `/proc/...`: the failure
 * is then a property of the path we built (portable, and identical for root and non-root),
 * not of the machine's permissions or of procfs.
 */
const unwritableDir = (): string => {
  const d = dir()
  writeFileSync(join(d, 'blocker'), 'not a directory')
  return join(d, 'blocker', 'nested')
}

describe('createApiTokenStore', () => {
  it('creates a 64-hex token file with mode 0600 on first read', () => {
    const d = dir()
    const store = createApiTokenStore({ dir: d })

    const token = store.current()

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(d, API_TOKEN_FILENAME), 'utf8')).toBe(token)
    expect(statSync(join(d, API_TOKEN_FILENAME)).mode & 0o777).toBe(0o600)
  })

  it('reads an existing file back instead of minting', () => {
    const d = dir()
    writeFileSync(join(d, API_TOKEN_FILENAME), 'a'.repeat(64), { mode: 0o600 })

    expect(createApiTokenStore({ dir: d }).current()).toBe('a'.repeat(64))
  })

  it('replaces a malformed file (never trusts it)', () => {
    const d = dir()
    writeFileSync(join(d, API_TOKEN_FILENAME), 'not hex\n')

    expect(createApiTokenStore({ dir: d }).current()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('regenerate writes a new value and current() returns it', () => {
    const d = dir()
    const store = createApiTokenStore({ dir: d })
    const first = store.current()

    const second = store.regenerate()

    expect(second).not.toBe(first)
    expect(store.current()).toBe(second)
    expect(readFileSync(join(d, API_TOKEN_FILENAME), 'utf8')).toBe(second)
  })

  it('a write failure logs a code, never the token, and keeps an in-memory token', () => {
    const log = vi.fn()
    const store = createApiTokenStore({ dir: unwritableDir(), log })

    expect(store.current()).toMatch(/^[0-9a-f]{64}$/)
    expect(log).toHaveBeenCalledWith('[claude-watcher][api] code=token_write_failed')
    expect(String(log.mock.calls)).not.toContain(store.current())
  })
})
