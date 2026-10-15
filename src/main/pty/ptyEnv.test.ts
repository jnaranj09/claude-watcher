// PTY environment — unit tests for the spawn-env sanitizer.
//
// Runs under the `main-unit` Vitest project (node).
//
// THE BUG THIS FIXES (observed live, 2026-08-27): the app copied its ENTIRE environment
// into every spawned claude. When the app itself is launched from inside a Claude Code
// session — `npm run dev` from a claude terminal, or the app started from one — the child
// claude inherits the PARENT session's markers and announces:
//
//   ⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
//
// A session with no transcript is invisible to `transcriptWatcher`, so the app cannot see
// an Esc interrupt or a background task finishing. It also inherited the parent's
// CLAUDE_CODE_SESSION_ID and messaging socket, which is wrong on its own terms.
//
// A claude started from a normal terminal has NONE of these set, so stripping the whole
// CLAUDE_CODE_* family is exactly "launch like a normal terminal would".

import { describe, it, expect } from 'vitest'
import { buildPtyEnv } from './ptyEnv'

describe('buildPtyEnv — a spawned claude must not inherit the launcher claude session', () => {
  it('strips the child-session marker that disables transcripts', () => {
    const env = buildPtyEnv({ PATH: '/usr/bin', CLAUDE_CODE_CHILD_SESSION: '1' })
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('strips the parent session id, bridge id and messaging credentials', () => {
    const env = buildPtyEnv({
      CLAUDE_CODE_SESSION_ID: '480232c9',
      CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_01',
      CLAUDE_CODE_MESSAGING_SOCKET: '/run/user/1000/cc-socks/1.sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/versions/2.1.248'
    })
    expect(Object.keys(env)).toEqual([])
  })

  it('strips any FUTURE CLAUDE_CODE_* variable without needing an edit', () => {
    const env = buildPtyEnv({ CLAUDE_CODE_SOMETHING_NEW: 'x', HOME: '/home/u' })
    expect(env.CLAUDE_CODE_SOMETHING_NEW).toBeUndefined()
    expect(env.HOME).toBe('/home/u')
  })

  it('keeps everything else, including unrelated CLAUDE-ish names', () => {
    const env = buildPtyEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      SHELL: '/bin/bash',
      TERM: 'xterm-256color',
      ANTHROPIC_API_KEY: 'k',
      CLAUDECODE: '1',
      MY_CLAUDE_CODE_THING: 'keep'
    })
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      SHELL: '/bin/bash',
      TERM: 'xterm-256color',
      ANTHROPIC_API_KEY: 'k',
      CLAUDECODE: '1',
      MY_CLAUDE_CODE_THING: 'keep'
    })
  })

  it('still strips the smoke-harness variables', () => {
    const env = buildPtyEnv({
      C9_SMOKE: '1',
      C9_SMOKE_OUT: '/tmp/o',
      C9_TEST_PICK_DIR: '/tmp/p',
      PATH: '/usr/bin'
    })
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('strips the e2e data-dir variable', () => {
    const env = buildPtyEnv({ CLAUDE_WATCHER_E2E_DATA_DIR: '/tmp/cw-e2e-x', PATH: '/usr/bin' })
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('drops undefined values rather than passing them through', () => {
    const env = buildPtyEnv({ PATH: '/usr/bin', NOPE: undefined })
    expect('NOPE' in env).toBe(false)
  })

  it('defaults to the real process environment when given no source', () => {
    // PATH is in every real environment and is not one of the stripped variables.
    expect(process.env['PATH']).toBeTruthy()
    expect(buildPtyEnv()['PATH']).toBe(process.env['PATH'])
  })
})
