// launchSession tests, part 1: launching. `main-unit` project (node). NO real node-pty (the terminal
// manager is a fake), NO live `claude` (the `/proc` reader is an injected fake; see
// __fixtures__/launchProc).
//
// Covered: launch() registers the durable picked-cwd recipe and returns the opaque terminalId;
// the folder preflight; mintSpawn (a fresh uuid-shaped `--session-id` per ACTUAL spawn, first open
// AND Reopen; the terminalId -> sessionId binding; launched-set membership at mint time); the
// operator-typed session name; the optimistic card and the subtree-ancestry join (a session whose
// process DESCENDS from the PTY leader correlates, one that does not is never claimed); never-crash
// on a fail-closed `/proc` read; the Linux gate. Bindings, forget, rebind and templates are in
// launchSession.bindings.test.ts; the programmatic API and past sessions in
// launchSession.api.test.ts.
import { describe, it, expect, vi } from 'vitest'
import {
  createLaunchService,
  isFolderMissing,
  LAUNCH_FOLDER_MISSING,
  NO_LAUNCH_FLAGS,
  type LaunchService,
  type LaunchTerminalManager
} from './launchSession'
import { createLaunchedSet } from './launchedSet'
import {
  LEADER_PID,
  NPM_PID,
  REPORTED_PID,
  SESSION_TGID,
  fakeTerminalManager,
  launchTree,
  readStatusFrom,
  session,
  shellClaudeSpawn,
  status
} from '../../__fixtures__/launchProc'

/** RFC-4122-shaped uuid matcher (the default newSessionId is node:crypto randomUUID). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('launchSession.launch — raw claude via the REUSED terminal manager (AC-1)', () => {
  it('mints an opaque terminalId and registers the durable picked-cwd recipe', () => {
    const { manager } = fakeTerminalManager({})
    let n = 0
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom({}),
      newTerminalId: () => `t-${++n}`,
      now: () => 0,
      platform: 'linux'
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
    const { manager } = fakeTerminalManager({})
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom({}),
      platform: 'linux'
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
      terminalManager: fakeTerminalManager({}).manager,
      launchedSet: createLaunchedSet(),
      isDirectory,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom({}),
      newTerminalId: () => 't-1',
      now: () => 0,
      platform: 'linux'
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
    onCorrelated: ReturnType<typeof vi.fn>
  } {
    const set = overrides.set ?? createLaunchedSet()
    const onCorrelated = vi.fn()
    let n = 0
    const svc = createLaunchService({
      terminalManager: fakeTerminalManager({ 't-1': LEADER_PID }).manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => `t-${++n}`,
      ...(overrides.newSessionId !== undefined ? { newSessionId: overrides.newSessionId } : {}),
      now: () => 0,
      platform: 'linux',
      onCorrelated
    })
    return { svc, set, onCorrelated }
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

  it('marks the launch already-joined: the ancestry walk never re-claims it or double-pushes', () => {
    let s = 0
    const { svc, set, onCorrelated } = mintService({ newSessionId: () => `sess-${++s}` })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')

    // The exact binding supersedes the heuristic: the launch is no longer pending...
    expect(svc.isPending('t-1')).toBe(false)
    // ...so a later c9watch delta for the SAME session (claude runs under our minted id and
    // descends from our PTY leader) never re-fires the ancestry onCorrelated push.
    svc.correlateAgainst([session('sess-1', REPORTED_PID)])
    expect(onCorrelated).not.toHaveBeenCalled()
    expect(set.size()).toBe(1) // idempotent — no second membership, no steal
  })

  it('the recipe is durable across forget(): a Reopen after a real exit mints a fresh claude spawn', () => {
    let s = 0
    const { svc } = mintService({ newSessionId: () => `sess-${++s}` })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.mintSpawn('t-1')

    // claude exits for real → index.ts onExit calls forget() (drops correlation tracking ONLY).
    svc.forget('t-1')

    // The dead-pane Reopen triggers a NEW actual spawn: the durable cwd recipe survives and a
    // FRESH identity is minted (never the default $SHELL, never the consumed sess-1).
    const reopened = svc.mintSpawn('t-1')
    expect(reopened?.sessionId).toBe('sess-2')
    expect(reopened?.spawn.cwd).toBe('/p')
    expect(reopened?.spawn.args).toEqual(['-l', '-c', "claude --session-id 'sess-2'"])
    expect(svc.sessionIdFor('t-1')).toBe('sess-2')
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
    const { manager } = fakeTerminalManager({ 't-1': 100 })
    let i = 0
    return createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom({}),
      newTerminalId: () => 't-1',
      newSessionId: () => ids[i++] ?? 'sess-x',
      platform: 'linux'
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

  it('forget() drops correlation tracking but NOT the recipe (Story 5.4 — cwd and name both stay)', () => {
    const svc = svcWithMints(['sess-1', 'sess-2'])
    svc.launch({ cwd: '/home/op/api', name: 'billing api' })
    svc.mintSpawn('t-1')
    svc.forget('t-1') // claude exited for real
    const after = svc.mintSpawn('t-1')
    expect(after?.spawn.cwd).toBe('/home/op/api')
    expect(after?.displayName).toBe('billing api')
  })

  it('two launches in the SAME cwd keep DISTINCT names (spec AC-4 — the problem the feature solves)', () => {
    const { manager } = fakeTerminalManager({ 't-1': 100, 't-2': 200 })
    let t = 0
    let s = 0
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom({}),
      newTerminalId: () => `t-${++t}`,
      newSessionId: () => `sess-${++s}`,
      platform: 'linux'
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

describe('launchSession — optimistic card + the subtree-ancestry join (Story 5.5)', () => {
  it('the join lands: a session DESCENDING from the PTY leader correlates → its id enters the set', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': LEADER_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p', name: 'p' })
    // The reported pid is a deep descendant's wandering thread, NOT the leader — the naive
    // spawnedPid===reportedPid (or even Tgid===leader) would FAIL; the ANCESTRY walk succeeds.
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])

    expect(set.has('sess-A')).toBe(true) // joined, keyed on the stable id
    expect(svc.isPending('t-1')).toBe(false) // reconciled
    expect(REPORTED_PID).not.toBe(LEADER_PID) // the tracked session is NOT the PTY leader
    expect(SESSION_TGID).not.toBe(LEADER_PID) // ...and its Tgid differs from the leader (deep nest)
  })

  it('no false claim: a session whose process is NOT under the PTY leader is never matched', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': LEADER_PID })
    // An UNRELATED claude (e.g. a different terminal, or the operator's own agent): its ancestry
    // reaches init (1) WITHOUT crossing our PTY leader.
    const OTHER_REPORTED = 990001
    const OTHER_TGID = 990000
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom({
        [OTHER_REPORTED]: status(OTHER_REPORTED, OTHER_TGID, OTHER_TGID, 'MainThread'),
        [OTHER_TGID]: status(OTHER_TGID, OTHER_TGID, 1, 'MainThread') // parent=init → not under us
      }),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.correlateAgainst([session('sess-other', OTHER_REPORTED)])

    expect(set.size()).toBe(0) // NO false membership — the session isn't ours
    expect(svc.isPending('t-1')).toBe(true) // still App-launched-optimistic, awaiting OUR session
  })

  it('the optimistic window: pidOf null (terminal not open yet) → pending, NO membership', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': null }) // terminal not open → no leader pid yet
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])

    expect(svc.isPending('t-1')).toBe(true) // optimistic — retries when pidOf resolves
    expect(set.size()).toBe(0)
  })

  it('reconciles on a LATER delta (re-resolve each tick — the reported pid wanders, never cached)', () => {
    const set = createLaunchedSet()
    // pidOf is stable (the PTY leader does not wander). The session subtree appears only on tick 2,
    // and the reported pid is a DIFFERENT wandering thread each tick.
    const REPORTED_T2 = 463999
    const tableRef = { current: {} as Record<number, string> }
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: (pid: number): string => {
        const blob = tableRef.current[pid]
        if (blob === undefined) throw new Error('ENOENT')
        return blob
      },
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p', name: 'p' })

    // Tick 1: the session's process is not in /proc yet (subtree not spawned) → resolveTgid throws
    // → no match.
    svc.correlateAgainst([session('sess-A', 463900)])
    expect(set.size()).toBe(0)

    // Tick 2: the subtree exists + the session reports a DIFFERENT wandering pid → ancestry join.
    tableRef.current = {
      [REPORTED_T2]: status(REPORTED_T2, SESSION_TGID, SESSION_TGID, 'MainThread'),
      [SESSION_TGID]: status(SESSION_TGID, SESSION_TGID, NPM_PID, 'MainThread'),
      [NPM_PID]: status(NPM_PID, NPM_PID, LEADER_PID, 'npm exec claude')
    }
    svc.correlateAgainst([session('sess-A', REPORTED_T2)])
    expect(set.has('sess-A')).toBe(true)
  })
})

describe('launchSession — never-crash / fail-closed', () => {
  it('a process-gone reported pid fails closed (no throw, no false membership), keeps scanning', () => {
    const set = createLaunchedSet()
    const log = vi.fn()
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      // the FIRST session's pid is gone (readStatus throws → matched:false); the SECOND session
      // is a real descendant of the PTY leader → matches.
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux',
      log
    })
    svc.launch({ cwd: '/p', name: 'p' })
    // sess-gone's pid 999999 is absent from /proc (reader throws → fail closed); sess-A joins.
    expect(() =>
      svc.correlateAgainst([session('sess-gone', 999999), session('sess-A', REPORTED_PID)])
    ).not.toThrow()
    expect(set.has('sess-gone')).toBe(false)
    expect(set.has('sess-A')).toBe(true)
  })

  it('does not double-claim: a session already in the launched-set is skipped by other launches', () => {
    const set = createLaunchedSet()
    set.add('sess-A') // already claimed by a prior launch
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-2',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])
    // sess-A was already claimed → this launch stays pending (it does not steal the claim).
    expect(svc.isPending('t-2')).toBe(true)
    expect(set.size()).toBe(1)
  })
})

describe('launchSession — Linux gate (/proc is Linux)', () => {
  it('skips the correlation on a non-linux platform (the launched-set stays empty)', () => {
    const set = createLaunchedSet()
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      isDirectory: () => true,
      spawn: shellClaudeSpawn,
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'darwin'
    })
    svc.launch({ cwd: '/p', name: 'p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])
    expect(set.size()).toBe(0) // correlation skipped off-Linux; the terminal still works
  })
})
