// launchSession tests, part 1: launching. `main-unit` project (node). NO real node-pty and NO live
// `claude` (the spawn factory is a fixture; see __fixtures__/launchProc).
//
// Covered: launch() registers the durable picked-cwd recipe and returns the opaque terminalId;
// the folder preflight; mintSpawn (a fresh uuid-shaped `--session-id` per ACTUAL spawn, first open
// AND Reopen; the terminalId -> sessionId binding; launched-set membership at mint time); the
// operator-typed session name. Bindings, rebind and templates are in
// launchSession.bindings.test.ts; the programmatic API and past sessions in
// launchSession.api.test.ts.
import { describe, it, expect } from 'vitest'
import {
  createLaunchService,
  isFolderMissing,
  LAUNCH_FOLDER_MISSING,
  NO_LAUNCH_FLAGS,
  type LaunchService
} from './launchSession'
import { createLaunchedSet } from './launchedSet'
import { shellClaudeSpawn } from '../../__fixtures__/launchProc'

/** RFC-4122-shaped uuid matcher (the default newSessionId is node:crypto randomUUID). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('launchSession.launch — raw claude recipe (AC-1)', () => {
  it('mints an opaque terminalId and registers the durable picked-cwd recipe', () => {
    let n = 0
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      newTerminalId: () => `t-${++n}`,
      now: () => 0
    })

    const out = svc.launch({ cwd: '/home/op/proj', name: 'proj' })
    expect(out.terminalId).toBe('t-1')
    // The durable recipe main consults is the picked cwd (Story 6.2: file/args/env are composed
    // per spawn by mintSpawn — they carry the freshly-minted --session-id).
    const ov = svc.peekSpawnOverride('t-1')
    // Session-naming: the operator-typed name rides the SAME entry as the cwd — both are
    // per-terminal launch-recipe values, set once at launch and read per spawn.
    expect(ov).toEqual({
      cwd: '/home/op/proj',
      name: 'proj',
      flags: NO_LAUNCH_FLAGS,
      templateId: null,
      initialPrompt: null,
      workspaceId: null,
      launchedAt: 0,
      resume: null,
      lastSessionId: null
    })
    // NON-CONSUMING (Story 5.4): a second peek returns the SAME recipe. The recipe is durable so
    // a StrictMode dev double-mount's surviving open AND a Reopen both still spawn claude (a
    // consume-once read was the dev blank-terminal bug + the latent Reopen bug).
    expect(svc.peekSpawnOverride('t-1')).toEqual(ov)
  })

  it('a non-launch terminalId has no override (the Story-3.1 host path is unaffected)', () => {
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn
    })
    expect(svc.peekSpawnOverride('host-term-0')).toBeNull()
  })
})

// UX-11 — the launch PREFLIGHT. node-pty spawns into a missing cwd without throwing; the child
// fails its chdir and exits, after the card was synthesized and a past-session record written.
// So the service refuses a missing folder BEFORE it registers anything.
describe('launchSession.launch — folder preflight (UX-11)', () => {
  function svcWith(isDirectory: (p: string) => boolean): LaunchService {
    return createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory,
      spawn: shellClaudeSpawn,
      newTerminalId: () => 't-1',
      now: () => 0
    })
  }

  it('throws folder_missing and registers NO recipe when the cwd is not a directory', () => {
    const seen: string[] = []
    const svc = svcWith((p) => {
      seen.push(p)
      return false
    })
    expect(() => svc.launch({ cwd: '/gone', name: 'x' })).toThrow(LAUNCH_FOLDER_MISSING)
    expect(seen).toEqual(['/gone'])
    expect(svc.peekSpawnOverride('t-1')).toBeNull()
    expect(svc.mintSpawn('t-1')).toBeNull()
  })

  it('isFolderMissing recognises exactly that refusal', () => {
    const svc = svcWith(() => false)
    let caught: unknown = null
    try {
      svc.launch({ cwd: '/gone', name: 'x' })
    } catch (e) {
      caught = e
    }
    expect(isFolderMissing(caught)).toBe(true)
    expect(isFolderMissing(new Error('other'))).toBe(false)
    expect(isFolderMissing('folder_missing')).toBe(false)
  })

  it('an existing folder launches as before', () => {
    const svc = svcWith(() => true)
    expect(svc.launch({ cwd: '/w', name: 'x' })).toEqual({ terminalId: 't-1' })
    expect(svc.peekSpawnOverride('t-1')?.cwd).toBe('/w')
  })
})

describe('Story 6.2 — mintSpawn: session identity minted at ACTUAL spawn time', () => {
  function mintService(overrides: { newSessionId?: () => string; set?: LaunchedSetLike } = {}): {
    svc: ReturnType<typeof createLaunchService>
    set: LaunchedSetLike
  } {
    const set = overrides.set ?? createLaunchedSet()
    let n = 0
    const svc = createLaunchService({
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      newTerminalId: () => `t-${++n}`,
      ...(overrides.newSessionId !== undefined ? { newSessionId: overrides.newSessionId } : {}),
      now: () => 0
    })
    return { svc, set }
  }
  type LaunchedSetLike = ReturnType<typeof createLaunchedSet>

  it('composes `claude --session-id <uuid>` (uuid-shaped, single-quoted) through the injected factory', () => {
    const { svc } = mintService() // DEFAULT newSessionId — proves the real randomUUID shape
    svc.launch({ cwd: '/home/op/proj', name: 'proj' })

    const minted = svc.mintSpawn('t-1')
    expect(minted).not.toBeNull()
    // uuid-shaped identity (node:crypto randomUUID by default).
    expect(minted?.sessionId).toMatch(UUID_RE)
    // The composed command keeps the $SHELL -l -c wrapper and single-quotes the uuid.
    expect(minted?.spawn.file).toBe('/bin/bash')
    expect(minted?.spawn.args).toEqual(['-l', '-c', `claude --session-id '${minted?.sessionId}'`])
    // The durable picked cwd + the factory env ride along.
    expect(minted?.spawn.cwd).toBe('/home/op/proj')
    expect(minted?.spawn.env).toEqual({ PATH: '/usr/bin' })
  })

  it('adds the minted id to the launched-set AT spawn time (before any delta ships)', () => {
    let s = 0
    const { svc, set } = mintService({ newSessionId: () => `sess-${++s}` })
    svc.launch({ cwd: '/p', name: 'p' })
    expect(set.size()).toBe(0) // launch() alone mints NOTHING — identity is per actual spawn
    const minted = svc.mintSpawn('t-1')
    expect(minted?.sessionId).toBe('sess-1')
    expect(set.has('sess-1')).toBe(true) // membership is synchronous with the mint
  })

  it('a second mint for the SAME terminal (Reopen) gets a FRESH id and OVERWRITES the binding', () => {
    let s = 0
    const { svc, set } = mintService({ newSessionId: () => `sess-${++s}` })
    svc.launch({ cwd: '/p', name: 'p' })

    const first = svc.mintSpawn('t-1')
    expect(first?.sessionId).toBe('sess-1')
    expect(svc.sessionIdFor('t-1')).toBe('sess-1')

    // Reopen = a NEW actual spawn: NEVER re-use a consumed --session-id (claude-side
    // duplicate/resume risk). The binding map records the NEW identity.
    const second = svc.mintSpawn('t-1')
    expect(second?.sessionId).toBe('sess-2')
    expect(second?.spawn.args).toEqual(['-l', '-c', "claude --session-id 'sess-2'"])
    expect(svc.sessionIdFor('t-1')).toBe('sess-2') // overwritten
    // Both spawns' ids are launched-set members (the set is per-run, ids are permanent members).
    expect(set.has('sess-1')).toBe(true)
    expect(set.has('sess-2')).toBe(true)
  })

  it('returns null for a non-launch terminalId (no binding, no membership — plain-shell path)', () => {
    const { svc, set } = mintService()
    svc.launch({ cwd: '/p', name: 'p' })
    expect(svc.mintSpawn('host-term-0')).toBeNull()
    expect(svc.sessionIdFor('host-term-0')).toBeNull()
    expect(set.size()).toBe(0)
  })

  it('sessionIdFor is null before the first mint (launch() alone binds nothing)', () => {
    const { svc } = mintService()
    svc.launch({ cwd: '/p', name: 'p' })
    expect(svc.sessionIdFor('t-1')).toBeNull()
  })

  it('Story 6.3 — unbind() clears the binding, KEEPS the recipe, and is idempotent', () => {
    let s = 0
    const { svc } = mintService({ newSessionId: () => `sess-${++s}` })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')
    expect(svc.sessionIdFor('t-1')).toBe('sess-1')

    // A stop/exit removal consumed the binding → cleared (a second trigger resolves null).
    svc.unbind('t-1')
    expect(svc.sessionIdFor('t-1')).toBeNull()
    svc.unbind('t-1') // idempotent — a double unbind never throws
    expect(svc.sessionIdFor('t-1')).toBeNull()

    // The durable spawn-override is untouched: a later Reopen still finds its recipe and
    // mints a FRESH identity + binding (never the default $SHELL, never a stale id). It still
    // remembers the id it last ran (a dead-pane Delete drops that record).
    expect(svc.peekSpawnOverride('t-1')).toEqual({
      cwd: '/p',
      name: 'p',
      flags: NO_LAUNCH_FLAGS,
      templateId: null,
      initialPrompt: null,
      workspaceId: null,
      launchedAt: 0,
      resume: null,
      lastSessionId: 'sess-1'
    })
    const reopened = svc.mintSpawn('t-1')
    expect(reopened?.sessionId).toBe('sess-2')
    expect(svc.sessionIdFor('t-1')).toBe('sess-2')
  })
})

// Session-naming — the operator-typed name must reach the card synthesis.
//
// SCOPE NOTE (read before adding a "reopen keeps the name" test): a session name belongs to ONE
// session. There is NO UI path that re-spawns a terminal frame under its previous name — the dead
// pane's only action is "New session", which runs the full picker → name-prompt flow and mints a
// NEW terminalId. The re-mint cases below pin the `overrides` map's non-consuming contract (the
// same contract that makes a dev StrictMode double-mount re-spawn `claude` rather than `$SHELL`),
// NOT a user-facing "keep my old name" guarantee.
describe('launchSession — the operator-typed session name (session-naming)', () => {
  function svcWithMints(ids: string[]): ReturnType<typeof createLaunchService> {
    let i = 0
    return createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      newTerminalId: () => 't-1',
      newSessionId: () => ids[i++] ?? 'sess-x'
    })
  }

  it('mintSpawn returns the operator name as displayName (not the cwd basename)', () => {
    const svc = svcWithMints(['sess-1'])
    svc.launch({ cwd: '/home/op/api', name: 'billing api' })
    const minted = svc.mintSpawn('t-1')
    expect(minted?.displayName).toBe('billing api')
    // The cwd is unchanged — the name is additive, it does not redirect the spawn.
    expect(minted?.spawn.cwd).toBe('/home/op/api')
  })

  it('a second mint of the SAME terminalId reads the name back (overrides is non-consuming)', () => {
    const svc = svcWithMints(['sess-1', 'sess-2'])
    svc.launch({ cwd: '/home/op/api', name: 'billing api' })

    const first = svc.mintSpawn('t-1')
    expect(first?.sessionId).toBe('sess-1')
    expect(first?.displayName).toBe('billing api')

    // The dev StrictMode double-mount shape: stop → re-open the same terminalId → a FRESH uuid.
    // The recipe (cwd AND name) must still be there; reading it must not consume it.
    const second = svc.mintSpawn('t-1')
    expect(second?.sessionId).toBe('sess-2')
    expect(second?.displayName).toBe('billing api')
  })

  it('two launches in the SAME cwd keep DISTINCT names (spec AC-4 — the problem the feature solves)', () => {
    let t = 0
    let s = 0
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      newTerminalId: () => `t-${++t}`,
      newSessionId: () => `sess-${++s}`
    })
    const a = svc.launch({ cwd: '/home/op/api', name: 'billing api' })
    const b = svc.launch({ cwd: '/home/op/api', name: 'refunds api' })
    expect(a.terminalId).not.toBe(b.terminalId)

    const mintedA = svc.mintSpawn(a.terminalId)
    const mintedB = svc.mintSpawn(b.terminalId)
    expect(mintedA?.displayName).toBe('billing api')
    expect(mintedB?.displayName).toBe('refunds api')
    // Same directory, distinct identities — neither launch's name bleeds into the other.
    expect(mintedA?.spawn.cwd).toBe(mintedB?.spawn.cwd)
    expect(mintedA?.sessionId).not.toBe(mintedB?.sessionId)
  })

  it('carries the template id from launch() to the mint; the folder flow mints null', () => {
    const svc = svcWithMints(['sess-1'])
    svc.launch({ cwd: '/home/op/api', name: 'api', templateId: 'tpl-9' })
    expect(svc.mintSpawn('t-1')?.templateId).toBe('tpl-9')

    const folder = svcWithMints(['sess-2'])
    folder.launch({ cwd: '/home/op/api', name: 'api' })
    expect(folder.mintSpawn('t-1')?.templateId).toBeNull()
  })
})
