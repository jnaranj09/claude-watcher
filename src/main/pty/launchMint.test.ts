// Story 6.2 — the re-attach MINT GUARD (main-unit / node project; no Electron).
//
// These tests run the extracted mint decision (launchMint.ts) over the REAL launch service
// (spawn-time mint + binding, Story 6.2) and the REAL reducer (the instant-card upsert),
// mirroring the CH.terminalOpen handler in index.ts EXACTLY: `mintForOpen` decides, and the
// upsert/binding side effects happen ONLY when it returns a recipe.
//
// What must hold (the code-review F1 regression this pins):
//   - a RE-ATTACH to a LIVE terminal (StrictMode dev double-mount / focus round-trip,
//     Story 5.6) NEVER mints: `mintSpawn` is NOT called (the fault-injection assertion —
//     inlining the guard away, i.e. calling mintSpawn unconditionally, turns it red),
//     the terminalId → sessionId binding is NOT overwritten, and NO ghost card is upserted;
//   - a FRESH open (no live pty) mints exactly once;
//   - a Reopen of a DEAD terminal is a real spawn → a FRESH id (never a re-used uuid);
//   - a null launch service (open racing app-ready) and a non-launch (plain-shell)
//     terminalId both mint null, never throw.
import { describe, it, expect, vi } from 'vitest'
import { mintForOpen, type LiveTerminalSource } from './launchMint'
import { buildLaunchedSession } from './launchSynthesis'
import { createLaunchService, type LaunchService } from './launchSession'
import { createLaunchedSet } from './launchedSet'
import { createReducer, type Reducer } from '../c9watch/reducer'

const FIXED_NOW = 1_750_000_000_000
const CWD = '/home/op/proj'

/** A fake live-terminal registry exposing EXACTLY the `has` surface the guard reads:
 *  live after spawn, gone after exit (mirrors terminalManager's map semantics). */
function fakeLiveTerminals(): {
  manager: LiveTerminalSource
  spawn(terminalId: string): void
  exit(terminalId: string): void
} {
  const live = new Set<string>()
  return {
    manager: { has: (terminalId) => live.has(terminalId) },
    spawn: (terminalId) => live.add(terminalId),
    exit: (terminalId) => live.delete(terminalId)
  }
}

/** The REAL launch service with deterministic ids (mirrors launchRemoval.test.ts — the
 *  correlation seams are inert; the mint path only touches launch/mintSpawn/sessionIdFor). */
function realLaunchService(newSessionId: () => string): LaunchService {
  return createLaunchService({
    terminalManager: { pidOf: () => null },
    launchedSet: createLaunchedSet(),
    spawn: (sessionId) => ({ file: '/bin/bash', args: ['-l', '-c', `claude '${sessionId}'`] }),
    readStatus: () => {
      throw new Error('ENOENT') // never consulted on the mint path
    },
    newTerminalId: () => 't-1',
    newSessionId,
    platform: 'linux'
  })
}

/** The index.ts terminal:open mirror: the guard decides, and the Story-6.2 instant-card
 *  upsert runs ONLY on a non-null mint (`if (minted !== null) ...` in index.ts). */
function openMirror(
  terminalId: string,
  manager: LiveTerminalSource,
  svc: LaunchService | null,
  reducer: Reducer
): ReturnType<typeof mintForOpen> {
  const minted = mintForOpen(terminalId, manager, svc)
  if (minted !== null) {
    // Session-naming: call the SHIPPED synthesis (`buildLaunchedSession`) instead of re-declaring
    // the Session shape here. This mirror used to hardcode `sessionName: 'proj'`, which made it
    // look naming-aware while asserting nothing about naming — the "asserts a re-implemented
    // copy" defect class this repo keeps hitting. Now a synthesis regression reaches this file.
    reducer.upsertLaunched(buildLaunchedSession(minted, 51234))
  }
  return minted
}

describe('Story 6.2 — mintForOpen: fresh open mints exactly once', () => {
  it('a fresh open (no live pty) mints the identity: one mintSpawn call, binding + recipe', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const mintSpy = vi.spyOn(svc, 'mintSpawn')
    const reducer = createReducer({ now: () => FIXED_NOW })
    const { manager } = fakeLiveTerminals() // nothing live yet — this open WILL spawn

    const { terminalId } = svc.launch({ cwd: CWD, name: 'proj' })
    const minted = openMirror(terminalId, manager, svc, reducer)

    expect(mintSpy).toHaveBeenCalledTimes(1)
    expect(mintSpy).toHaveBeenCalledWith(terminalId)
    expect(minted?.sessionId).toBe('sess-1')
    expect(minted?.spawn.cwd).toBe(CWD)
    expect(minted?.spawn.args?.join(' ')).toContain("claude 'sess-1'") // the minted identity rides the spawn
    expect(svc.sessionIdFor(terminalId)).toBe('sess-1') // exact binding written
    expect(reducer.snapshotMap().has('sess-1')).toBe(true) // the ONE instant card
    expect(reducer.size()).toBe(1)
  })
})

describe('Story 6.2 — mintForOpen: re-attach to a LIVE terminal NEVER mints (the F1 guard)', () => {
  it('FAULT-INJECTION PROOF: the re-attach does NOT call mintSpawn — no second uuid, no binding overwrite, no ghost card', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const { manager, spawn } = fakeLiveTerminals()

    // Open #1 — the actual spawn: mints sess-1, upserts the card, pty goes live.
    const { terminalId } = svc.launch({ cwd: CWD, name: 'proj' })
    const first = openMirror(terminalId, manager, svc, reducer)
    expect(first?.sessionId).toBe('sess-1')
    spawn(terminalId) // the manager now holds a LIVE pty for this terminalId

    // Open #2 — the StrictMode re-attach (same terminalId, pty still live). The guard
    // must return null WITHOUT consulting mintSpawn: this spy assertion is the one that
    // turns RED if someone inlines the guard away (calls mintSpawn unconditionally).
    const mintSpy = vi.spyOn(svc, 'mintSpawn')
    const reattach = openMirror(terminalId, manager, svc, reducer)

    expect(reattach).toBeNull() // no recipe → index.ts spawns nothing new
    expect(mintSpy).not.toHaveBeenCalled() // ← the load-bearing fault-injection assertion
    expect(svc.sessionIdFor(terminalId)).toBe('sess-1') // binding NOT overwritten
    expect(reducer.size()).toBe(1) // NO ghost card synthesized
    expect(reducer.snapshotMap().has('sess-1')).toBe(true) // the original card intact
  })

  it('the preserved binding keeps Stop able to remove the ORIGINAL card after a re-attach', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const { manager, spawn } = fakeLiveTerminals()

    const { terminalId } = svc.launch({ cwd: CWD, name: 'proj' })
    openMirror(terminalId, manager, svc, reducer) // spawn → sess-1 card
    spawn(terminalId)
    openMirror(terminalId, manager, svc, reducer) // re-attach → no-op (guard holds)

    // The Story-6.3 removal path resolves the binding → it must still name sess-1, so the
    // removal takes the REAL card off the board (a regressed guard would resolve a ghost
    // id here and strand the original card forever).
    const bound = svc.sessionIdFor(terminalId)
    expect(bound).toBe('sess-1')
    const deltas = reducer.applyHookStatus(bound!, { kind: 'removed' })
    expect(deltas.map((d) => d.event.type)).toEqual(['session.removed'])
    expect(reducer.size()).toBe(0) // the board is actually clear — no stranded card
  })

  it('a Reopen of a DEAD terminal (pty exited) IS a real spawn → a FRESH id, fresh binding', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const { manager, spawn, exit } = fakeLiveTerminals()

    const { terminalId } = svc.launch({ cwd: CWD, name: 'proj' })
    openMirror(terminalId, manager, svc, reducer) // spawn #1 → sess-1
    spawn(terminalId)
    exit(terminalId) // claude died (double ctrl+c) — the pty is gone

    const reopened = openMirror(terminalId, manager, svc, reducer)
    expect(reopened?.sessionId).toBe('sess-2') // never a re-used --session-id
    expect(svc.sessionIdFor(terminalId)).toBe('sess-2') // Reopen overwrites the binding
  })
})

describe('Story 6.2 — mintForOpen: the null-service and plain-shell paths', () => {
  it('a null launch service (open racing app-ready) mints null and never throws', () => {
    const { manager } = fakeLiveTerminals()
    expect(mintForOpen('t-early', manager, null)).toBeNull()
  })

  it('a non-launch terminalId (the Story-3.1 host shell) mints null via the service', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const { manager } = fakeLiveTerminals()
    expect(mintForOpen('host-term-0', manager, svc)).toBeNull() // no launch recipe registered
    expect(svc.sessionIdFor('host-term-0')).toBeNull() // no binding invented
  })
})

// Name-sync — the operator's name must reach the spawn FACTORY, not just the card. That is
// what lets index.ts compose claude's `-n <name>`, so claude runs under the operator's name
// instead of inventing its own title. Without this, the board card and `claude --resume`
// disagree from the very first second. [spec-claude-session-name-sync.md]
describe('name-sync — the launch name reaches the spawn factory', () => {
  it('mintSpawn hands the operator-typed name to spawn(), beside the minted session id', () => {
    const seen: Array<{ sessionId: string; displayName: string }> = []
    const svc = createLaunchService({
      terminalManager: { pidOf: () => null },
      launchedSet: createLaunchedSet(),
      spawn: (sessionId, displayName) => {
        seen.push({ sessionId, displayName })
        return { file: '/bin/bash', args: ['-l', '-c', 'claude'] }
      },
      readStatus: () => {
        throw new Error('ENOENT')
      },
      newTerminalId: () => 't-1',
      newSessionId: () => 'sess-1',
      platform: 'linux'
    })

    const { terminalId } = svc.launch({ cwd: CWD, name: 'billing api' })
    svc.mintSpawn(terminalId)

    expect(seen).toEqual([{ sessionId: 'sess-1', displayName: 'billing api' }])
  })

  it('a re-mint of the SAME terminal passes the name again (the recipe is durable)', () => {
    const names: string[] = []
    let n = 0
    const svc = createLaunchService({
      terminalManager: { pidOf: () => null },
      launchedSet: createLaunchedSet(),
      spawn: (_sessionId, displayName) => {
        names.push(displayName)
        return { file: '/bin/bash', args: ['-l', '-c', 'claude'] }
      },
      readStatus: () => {
        throw new Error('ENOENT')
      },
      newTerminalId: () => 't-1',
      newSessionId: () => `sess-${++n}`,
      platform: 'linux'
    })

    const { terminalId } = svc.launch({ cwd: CWD, name: 'billing api' })
    svc.mintSpawn(terminalId)
    svc.mintSpawn(terminalId) // the dev StrictMode double-mount path

    // A fresh session id each time, but the SAME operator name — never reverting to a basename.
    expect(names).toEqual(['billing api', 'billing api'])
  })
})
