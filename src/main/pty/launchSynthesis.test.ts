// Session-naming — the launch-card synthesis contract (`buildLaunchedSession`).
//
// THE REGRESSION THIS FILE PINS: the operator's session name reaches the board through exactly
// ONE expression. It used to be inlined in `src/main/index.ts`, which no test can import — so
// reverting it to the pre-naming `basename(cwd)` left all 834 tests green. That is the "single
// point of failure with zero coverage" this module + file exist to close.
//
// FAULT-INJECTION STANDARD: changing `sessionName` in launchSynthesis.ts back to
// `basename(minted.spawn.cwd)` MUST turn the first test below RED.
import { describe, it, expect } from 'vitest'
import { buildLaunchedSession } from './launchSynthesis'
import type { MintedLaunchSpawn } from './launchSession'

function minted(over: Partial<MintedLaunchSpawn> = {}): MintedLaunchSpawn {
  return {
    sessionId: 'sess-uuid-1',
    displayName: 'billing api',
    spawn: {
      file: '/bin/bash',
      args: ['-l', '-c', "claude --session-id 'sess-uuid-1'"],
      cwd: '/home/op/api',
      env: { PATH: '/usr/bin' }
    },
    ...over
  }
}

describe('buildLaunchedSession — the operator name becomes card truth', () => {
  it('uses the OPERATOR name, not the cwd basename (the whole point of the feature)', () => {
    const session = buildLaunchedSession(minted(), 4242, 'default')
    expect(session.sessionName).toBe('billing api')
    // Non-vacuity: the basename is a DIFFERENT string, so this cannot pass by coincidence.
    expect(session.sessionName).not.toBe('api')
  })

  it('two launches in the SAME directory get DISTINCT names (spec AC-4)', () => {
    const a = buildLaunchedSession(
      minted({ sessionId: 'sess-a', displayName: 'billing api' }),
      1,
      'default'
    )
    const b = buildLaunchedSession(
      minted({ sessionId: 'sess-b', displayName: 'refunds api' }),
      2,
      'default'
    )
    expect(a.sessionName).not.toBe(b.sessionName)
    // ...while both still point at the same project directory.
    expect(a.projectPath).toBe(b.projectPath)
    expect(a.id).not.toBe(b.id)
  })

  it('carries the minted identity, the picked cwd and the pty pid through verbatim', () => {
    const session = buildLaunchedSession(minted(), 4242, 'default')
    expect(session.id).toBe('sess-uuid-1')
    expect(session.projectPath).toBe('/home/op/api')
    expect(session.pid).toBe(4242)
  })

  it('is born Connecting (hooks own every later transition)', () => {
    expect(buildLaunchedSession(minted(), 1, 'default').status).toBe('Connecting')
  })

  it('DEFENSIVE fallback: a blank displayName degrades to the cwd basename, never a blank title', () => {
    // Unreachable through the shipped launch path (SessionNameSchema.min(1) guarantees non-empty),
    // but a hand-constructed MintedLaunchSpawn must not put an empty title on the board.
    const session = buildLaunchedSession(minted({ displayName: '' }), 1, 'default')
    expect(session.sessionName).toBe('api')
  })

  it('a name that merely LOOKS like a path is not re-derived — it is used verbatim', () => {
    const session = buildLaunchedSession(minted({ displayName: 'api/v2 rewrite' }), 1, 'default')
    expect(session.sessionName).toBe('api/v2 rewrite')
  })

  it('stamps the workspaceId it is given', () => {
    const session = buildLaunchedSession(
      { sessionId: 'uuid-1', displayName: 'My session', spawn: { cwd: '/home/j/p' } } as never,
      4242,
      'w7'
    )
    expect(session.workspaceId).toBe('w7')
  })
})
