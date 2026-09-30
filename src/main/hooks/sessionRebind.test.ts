// Session-rebind — the mid-run session-id change guard (Part 1) + adoption proof (Part 2).
//
// Every assertion here is a FAULT INJECTION target: deleting the guard it covers in
// sessionRebind.ts must turn the matching test red. The four adoption conditions (exact cwd,
// exactly one match, pty alive, inside the window) each get their own negative case, because
// loosening ANY of them re-opens the Story-3.3 ship gate (external sessions on the board).

import { describe, it, expect, vi } from 'vitest'
import {
  claimByProcess,
  createOrphanRegistry,
  findAdoptionTarget,
  isAdoptableSessionId,
  sessionEndKeepsCard,
  REBIND_WINDOW_MS,
  type LiveTerminals,
  type ProcessSessionRecords,
  type RebindBindingSource
} from './sessionRebind'

/** A launch service whose bindings are a plain sessionId → terminalId table. */
function bindings(table: Record<string, string>): RebindBindingSource {
  return { terminalIdFor: (sessionId) => table[sessionId] ?? null }
}

/** A terminal manager where only the listed terminalIds are alive. */
function alive(...terminalIds: string[]): LiveTerminals {
  const set = new Set(terminalIds)
  return { has: (terminalId) => set.has(terminalId) }
}

const T0 = 1_000_000

describe('sessionEndKeepsCard (Part 1 — a SessionEnd on a LIVE pty is an id change)', () => {
  it('keeps the card when the bound pty is still alive', () => {
    const kept = sessionEndKeepsCard('sess-a', bindings({ 'sess-a': 'term-1' }), alive('term-1'))
    expect(kept).toBe('term-1')
  })

  it('lets a genuine removal through when the pty is gone', () => {
    // The stop/exit path is the authority; a SessionEnd after a real death must still remove.
    const kept = sessionEndKeepsCard('sess-a', bindings({ 'sess-a': 'term-1' }), alive())
    expect(kept).toBeNull()
  })

  it('lets a removal through for a session with no binding at all', () => {
    // Not an app launch (or the binding was already consumed by stop/exit) — never keep it.
    const kept = sessionEndKeepsCard('sess-x', bindings({}), alive('term-1'))
    expect(kept).toBeNull()
  })
})

describe('OrphanRegistry.claim (Part 2 — the adoption proof)', () => {
  const orphan = { terminalId: 'term-1', sessionId: 'sess-old', cwd: '/repo/a', orphanedAt: T0 }

  it('adopts the single orphan whose cwd matches exactly, alive and inside the window', () => {
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    expect(reg.claim('/repo/a', T0 + 1_000, alive('term-1'))).toEqual(orphan)
  })

  it('adopts at the exact window boundary but not one ms past it', () => {
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    expect(reg.claim('/repo/a', T0 + REBIND_WINDOW_MS, alive('term-1'))).toEqual(orphan)
    expect(reg.claim('/repo/a', T0 + REBIND_WINDOW_MS + 1, alive('term-1'))).toBeNull()
  })

  it('refuses a cwd that does not match exactly (no prefix / parent matching)', () => {
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    expect(reg.claim('/repo', T0, alive('term-1'))).toBeNull()
    expect(reg.claim('/repo/a/sub', T0, alive('term-1'))).toBeNull()
    expect(reg.claim('/repo/b', T0, alive('term-1'))).toBeNull()
  })

  it('refuses a blank incoming cwd (a hook with no cwd carries no proof)', () => {
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    expect(reg.claim('', T0, alive('term-1'))).toBeNull()
  })

  it('refuses an orphan recorded with a blank cwd (it can never be proven)', () => {
    const reg = createOrphanRegistry()
    reg.mark({ ...orphan, cwd: '' })
    expect(reg.claim('', T0, alive('term-1'))).toBeNull()
    expect(reg.claim('/repo/a', T0, alive('term-1'))).toBeNull()
  })

  it('refuses an AMBIGUOUS match — two live orphans in the same cwd adopt nothing', () => {
    // Two sessions launched into one repo is the normal case in this app, so this guard is
    // what stops the wrong card being re-keyed.
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    reg.mark({ terminalId: 'term-2', sessionId: 'sess-old-2', cwd: '/repo/a', orphanedAt: T0 })
    expect(reg.claim('/repo/a', T0, alive('term-1', 'term-2'))).toBeNull()
  })

  it('adopts again once the ambiguity is gone (one of the two ptys died)', () => {
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    reg.mark({ terminalId: 'term-2', sessionId: 'sess-old-2', cwd: '/repo/a', orphanedAt: T0 })
    expect(reg.claim('/repo/a', T0, alive('term-1'))).toEqual(orphan)
  })

  it('refuses an orphan whose pty is dead (its card was already removed by stop/exit)', () => {
    const reg = createOrphanRegistry()
    reg.mark(orphan)
    expect(reg.claim('/repo/a', T0, alive())).toBeNull()
  })

  it('refuses an empty registry', () => {
    expect(createOrphanRegistry().claim('/repo/a', T0, alive('term-1'))).toBeNull()
  })
})

describe('OrphanRegistry bookkeeping', () => {
  it('clear() makes an orphan unclaimable and is idempotent', () => {
    const reg = createOrphanRegistry()
    reg.mark({ terminalId: 'term-1', sessionId: 'sess-old', cwd: '/repo/a', orphanedAt: T0 })
    reg.clear('term-1')
    reg.clear('term-1')
    reg.clear('never-seen')
    expect(reg.size()).toBe(0)
    expect(reg.claim('/repo/a', T0, alive('term-1'))).toBeNull()
  })

  it('re-marking a terminal REPLACES its record (the newest id change wins)', () => {
    const reg = createOrphanRegistry()
    reg.mark({ terminalId: 'term-1', sessionId: 'sess-1', cwd: '/repo/a', orphanedAt: T0 })
    reg.mark({ terminalId: 'term-1', sessionId: 'sess-2', cwd: '/repo/a', orphanedAt: T0 + 5 })
    expect(reg.size()).toBe(1)
    expect(reg.claim('/repo/a', T0 + 10, alive('term-1'))?.sessionId).toBe('sess-2')
  })

  it('honours an injected window', () => {
    const reg = createOrphanRegistry({ windowMs: 10 })
    reg.mark({ terminalId: 'term-1', sessionId: 'sess-old', cwd: '/repo/a', orphanedAt: T0 })
    expect(reg.claim('/repo/a', T0 + 10, alive('term-1'))).not.toBeNull()
    expect(reg.claim('/repo/a', T0 + 11, alive('term-1'))).toBeNull()
  })
})

describe("claimByProcess (Part 2b — the EXACT proof from claude's own per-process record)", () => {
  const launches = [
    { terminalId: 'term-1', sessionId: 'sess-old' },
    { terminalId: 'term-2', sessionId: 'sess-other' }
  ]
  /** A terminal manager: terminalId → PTY leader pid (absent = dead). */
  function pids(table: Readonly<Record<string, number>>): { pidOf: (t: string) => number | null } {
    return { pidOf: (terminalId) => table[terminalId] ?? null }
  }
  /** Claude's records: leader pid → the session ids recorded under it. */
  function recorded(table: Readonly<Record<number, readonly string[]>>): ProcessSessionRecords {
    return { currentSessionIdsUnder: (leaderPid) => table[leaderPid] ?? [] }
  }

  it('adopts the launch whose process now records the incoming id — no cwd, no window', () => {
    const claim = claimByProcess(
      'sess-new',
      launches,
      pids({ 'term-1': 111, 'term-2': 222 }),
      recorded({ 111: ['sess-new'] })
    )
    expect(claim).toEqual({ terminalId: 'term-1', sessionId: 'sess-old' })
  })

  it('refuses when no launched process records the id (an external claude never reaches the board)', () => {
    const claim = claimByProcess(
      'sess-new',
      launches,
      pids({ 'term-1': 111, 'term-2': 222 }),
      recorded({ 111: ['sess-old'], 222: ['sess-other'] })
    )
    expect(claim).toBeNull()
  })

  it('picks the RIGHT terminal among several — the proof is per process', () => {
    const claim = claimByProcess(
      'sess-new',
      launches,
      pids({ 'term-1': 111, 'term-2': 222 }),
      recorded({ 111: ['sess-old'], 222: ['sess-new'] })
    )
    expect(claim).toEqual({ terminalId: 'term-2', sessionId: 'sess-other' })
  })

  it('skips a launch whose pty is gone without consulting the records', () => {
    const consulted: number[] = []
    const records: ProcessSessionRecords = {
      currentSessionIdsUnder: (leaderPid) => {
        consulted.push(leaderPid)
        return ['sess-new']
      }
    }
    expect(claimByProcess('sess-new', launches, pids({ 'term-2': 222 }), records)).toEqual({
      terminalId: 'term-2',
      sessionId: 'sess-other'
    })
    expect(consulted).toEqual([222])
  })

  it('never "adopts" a terminal onto the id it is already bound to (that would delete its card)', () => {
    const claim = claimByProcess(
      'sess-old',
      launches,
      pids({ 'term-1': 111 }),
      recorded({ 111: ['sess-old'] })
    )
    expect(claim).toBeNull()
  })

  // R18 — never adopt on ambiguity. Two candidates for one id is not a proof.
  it('refuses when TWO launched terminals record the incoming id (ambiguous — no pid proof)', () => {
    const claim = claimByProcess(
      'sess-new',
      launches,
      pids({ 'term-1': 111, 'term-2': 222 }),
      recorded({ 111: ['sess-new'], 222: ['sess-new'] })
    )
    expect(claim).toBeNull()
  })

  it('refuses when one terminal records the incoming id twice (two outermost claudes — ambiguous)', () => {
    const claim = claimByProcess(
      'sess-new',
      launches,
      pids({ 'term-1': 111 }),
      recorded({ 111: ['sess-new', 'sess-new'] })
    )
    expect(claim).toBeNull()
  })
})

describe('OrphanRegistry.claim — a refusal caused by the window ALONE is reported', () => {
  const orphan = { terminalId: 'term-1', sessionId: 'sess-old', cwd: '/repo/a', orphanedAt: T0 }

  it('calls onWindowRefusal with the terminal when cwd matched, the pty is alive, and only the window refused', () => {
    const refused: string[] = []
    const reg = createOrphanRegistry({ onWindowRefusal: (terminalId) => refused.push(terminalId) })
    reg.mark(orphan)
    expect(reg.claim('/repo/a', T0 + REBIND_WINDOW_MS + 1, alive('term-1'))).toBeNull()
    expect(refused).toEqual(['term-1'])
  })

  it('stays silent for a cwd mismatch, a dead pty, or a claim inside the window', () => {
    const refused: string[] = []
    const reg = createOrphanRegistry({ onWindowRefusal: (terminalId) => refused.push(terminalId) })
    reg.mark(orphan)
    expect(reg.claim('/repo/b', T0 + REBIND_WINDOW_MS + 1, alive('term-1'))).toBeNull()
    expect(reg.claim('/repo/a', T0 + REBIND_WINDOW_MS + 1, alive())).toBeNull()
    expect(reg.claim('/repo/a', T0 + 1, alive('term-1'))).toEqual(orphan)
    expect(refused).toEqual([])
  })
})

// SEC-1 hardening: an adopted id becomes the card's id, is archived, and later reaches a
// `claude --resume` shell command. claude's own ids are UUIDs, so anything else is forged.
describe('isAdoptableSessionId', () => {
  it('accepts a claude session UUID', () => {
    expect(isAdoptableSessionId('3f2b8c1e-9a4d-4e7f-8b2c-1d0e6f5a7b9c')).toBe(true)
  })

  it.each([
    ['a quote-breaking payload', "x'; touch /tmp/pwned; '"],
    ['an empty string', ''],
    ['a UUID with trailing text', '3f2b8c1e-9a4d-4e7f-8b2c-1d0e6f5a7b9c; id'],
    ['a UUID with a newline', '3f2b8c1e-9a4d-4e7f-8b2c-1d0e6f5a7b9c\n'],
    ['a UUID missing a group', '3f2b8c1e-9a4d-4e7f-1d0e6f5a7b9c']
  ])('refuses %s', (_label, id) => {
    expect(isAdoptableSessionId(id)).toBe(false)
  })
})

// SEC-1 hardening, wired: the UUID check runs BEFORE either proof, so a forged id never adopts a
// card and never uses up the orphan record a real `/clear` would need.
describe('findAdoptionTarget', () => {
  const NEW_ID = '3f2b8c1e-9a4d-4e7f-8b2c-1d0e6f5a7b9c'
  const hit = { terminalId: 'term-1', sessionId: 'old-id' }

  it('a non-UUID id: refused before either proof is tried, logged by code only', () => {
    const byProcess = vi.fn(() => hit)
    const byOrphan = vi.fn(() => hit)
    const log = vi.fn()
    const bad = "x'; touch /tmp/pwned; '"
    expect(findAdoptionTarget(bad, { byProcess, byOrphan }, log)).toBeNull()
    expect(byProcess).not.toHaveBeenCalled()
    expect(byOrphan).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[c9watch][hooks] path=(hook) code=hook_rebind_bad_id')
    for (const [line] of log.mock.calls) expect(String(line)).not.toContain('pwned')
  })
  it('the pid proof wins, and the orphan record is left alone', () => {
    const byOrphan = vi.fn(() => hit)
    expect(findAdoptionTarget(NEW_ID, { byProcess: () => hit, byOrphan }, vi.fn())).toEqual({
      ...hit,
      proof: 'pid'
    })
    expect(byOrphan).not.toHaveBeenCalled()
  })
  it('falls back to the cwd orphan when there is no pid proof', () => {
    expect(
      findAdoptionTarget(NEW_ID, { byProcess: () => null, byOrphan: () => hit }, vi.fn())
    ).toEqual({ ...hit, proof: 'cwd' })
  })
  it('no proof at all: null', () => {
    expect(
      findAdoptionTarget(NEW_ID, { byProcess: () => null, byOrphan: () => null }, vi.fn())
    ).toBeNull()
  })
})
