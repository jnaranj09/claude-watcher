// launchSession tests, part 2: the terminalId <-> sessionId bindings. `main-unit` project (node).
// Covered: terminalIdFor / rebind when claude changes its own id mid-run; bindings() lists every
// live terminal; template launch flags reach spawn(). Fakes: __fixtures__/launchProc.
import { describe, it, expect } from 'vitest'
import { createLaunchService, NO_LAUNCH_FLAGS, type ClaudeLaunchFlags } from './launchSession'
import { createLaunchedSet } from './launchedSet'
import { shellClaudeSpawn } from '../../__fixtures__/launchProc'

describe('Session-rebind — terminalIdFor / rebind (claude changes its own id mid-run)', () => {
  function reboundService(): ReturnType<typeof createLaunchService> {
    let s = 0
    return createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      newTerminalId: () => 't-1',
      newSessionId: () => `sess-${++s}`
    })
  }

  it('terminalIdFor is the exact reverse of sessionIdFor', () => {
    const svc = reboundService()
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')
    expect(svc.sessionIdFor('t-1')).toBe('sess-1')
    expect(svc.terminalIdFor('sess-1')).toBe('t-1')
  })

  it('terminalIdFor is null before any mint and for an unknown session id', () => {
    const svc = reboundService()
    svc.launch({ cwd: '/p', name: 'p' })
    expect(svc.terminalIdFor('sess-1')).toBeNull() // launch() alone binds nothing
    svc.mintSpawn('t-1')
    expect(svc.terminalIdFor('not-a-session')).toBeNull()
  })

  it('rebind MOVES a live binding so a later stop/exit removes the card the board shows', () => {
    const svc = reboundService()
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')
    svc.rebind('t-1', 'sess-new')
    expect(svc.sessionIdFor('t-1')).toBe('sess-new')
    expect(svc.terminalIdFor('sess-new')).toBe('t-1')
    // The old id no longer resolves — one terminal, one binding.
    expect(svc.terminalIdFor('sess-1')).toBeNull()
  })

  it('rebind NEVER invents a binding for a terminal that was never spawned (ship gate)', () => {
    // Inventing one here would let a session that this app never launched reach the board.
    const svc = reboundService()
    svc.launch({ cwd: '/p', name: 'p' }) // launched, but never minted/spawned
    svc.rebind('t-1', 'sess-external')
    expect(svc.sessionIdFor('t-1')).toBeNull()
    expect(svc.terminalIdFor('sess-external')).toBeNull()
    svc.rebind('never-seen-terminal', 'sess-external')
    expect(svc.terminalIdFor('sess-external')).toBeNull()
  })

  it('a rebound binding is still cleared by unbind (removal stays idempotent)', () => {
    const svc = reboundService()
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')
    svc.rebind('t-1', 'sess-new')
    svc.unbind('t-1')
    expect(svc.sessionIdFor('t-1')).toBeNull()
    expect(svc.terminalIdFor('sess-new')).toBeNull()
  })

  // Past sessions (D-3) — a Delete on a pane whose claude already exited has no binding left (the
  // exit ARCHIVED the card and consumed it), yet it must still drop that record. The durable
  // override remembers the id the terminal was LAST bound to, which the removal never clears.
  it('the override remembers the LAST bound id: set by a mint, kept by unbind, moved by rebind', () => {
    const svc = reboundService()
    svc.launch({ cwd: '/p', name: 'p' })
    expect(svc.peekSpawnOverride('t-1')?.lastSessionId).toBeNull() // nothing spawned yet

    svc.mintSpawn('t-1')
    expect(svc.peekSpawnOverride('t-1')?.lastSessionId).toBe('sess-1')
    svc.rebind('t-1', 'sess-cleared') // /clear — claude moved to a new id
    expect(svc.peekSpawnOverride('t-1')?.lastSessionId).toBe('sess-cleared')
    svc.unbind('t-1') // the pty exit consumed the binding...
    expect(svc.peekSpawnOverride('t-1')?.lastSessionId).toBe('sess-cleared') // ...not the memory
    svc.rebind('t-1', 'sess-stray') // no binding ⇒ rebind moves nothing, the memory included
    expect(svc.peekSpawnOverride('t-1')?.lastSessionId).toBe('sess-cleared')

    svc.mintSpawn('t-1') // a Reopen binds a fresh id, and that is now the last one
    expect(svc.peekSpawnOverride('t-1')?.lastSessionId).toBe('sess-2')
  })
})

describe('Session-rebind — bindings() lists every live terminal → session binding', () => {
  function service(): ReturnType<typeof createLaunchService> {
    let s = 0
    let t = 0
    return createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      newTerminalId: () => `t-${++t}`,
      newSessionId: () => `sess-${++s}`
    })
  }

  it('is empty before any mint (launch() alone binds nothing)', () => {
    const svc = service()
    svc.launch({ cwd: '/p', name: 'p' })
    expect(svc.bindings()).toEqual([])
  })

  it('lists each minted launch exactly once, as {terminalId, sessionId}', () => {
    const svc = service()
    svc.launch({ cwd: '/p', name: 'p' })
    svc.launch({ cwd: '/q', name: 'q' })
    svc.mintSpawn('t-1')
    svc.mintSpawn('t-2')
    expect(svc.bindings()).toEqual([
      { terminalId: 't-1', sessionId: 'sess-1' },
      { terminalId: 't-2', sessionId: 'sess-2' }
    ])
  })

  it('follows rebind and drops unbind (it is a view of the same table sessionIdFor reads)', () => {
    const svc = service()
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')
    svc.rebind('t-1', 'sess-new')
    expect(svc.bindings()).toEqual([{ terminalId: 't-1', sessionId: 'sess-new' }])
    svc.unbind('t-1')
    expect(svc.bindings()).toEqual([])
  })
})

describe('session templates — launch flags reach spawn()', () => {
  function flagService(): {
    svc: ReturnType<typeof createLaunchService>
    seen: ClaudeLaunchFlags[]
  } {
    const seen: ClaudeLaunchFlags[] = []
    let n = 0
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: (sessionId, _name, flags) => {
        seen.push(flags)
        return { file: 'sh', args: ['-l', '-c', `claude --session-id '${sessionId}'`] }
      },
      newTerminalId: () => `t-${++n}`,
      now: () => 0
    })
    return { svc, seen }
  }

  it('a folder launch spawns with NO_LAUNCH_FLAGS (all three null)', () => {
    const { svc, seen } = flagService()
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')
    expect(seen).toEqual([{ model: null, permissionMode: null, effort: null }])
    expect(svc.peekSpawnOverride('t-1')).toEqual({
      cwd: '/p',
      name: 'p',
      flags: NO_LAUNCH_FLAGS,
      templateId: null,
      initialPrompt: null,
      workspaceId: null,
      launchedAt: 0,
      resume: null,
      lastSessionId: expect.any(String) // the default randomUUID mint
    })
  })

  it('a template launch hands its flags to spawn(), and a re-spawn of the same terminal keeps them', () => {
    const { svc, seen } = flagService()
    const flags: ClaudeLaunchFlags = { model: 'opus', permissionMode: 'plan', effort: 'high' }
    svc.launch({ cwd: '/p', name: 'p', flags })
    svc.mintSpawn('t-1')
    svc.mintSpawn('t-1') // Reopen — the effort must survive a re-spawn of the same terminal
    expect(seen).toEqual([flags, flags])
  })
})
