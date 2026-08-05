// Session-rebind — the mid-run session-id change guard (Part 1) + adoption proof (Part 2).
//
// Every assertion here is a FAULT INJECTION target: deleting the guard it covers in
// sessionRebind.ts must turn the matching test red. The four adoption conditions (exact cwd,
// exactly one match, pty alive, inside the window) each get their own negative case, because
// loosening ANY of them re-opens the Story-3.3 ship gate (external sessions on the board).

import { describe, it, expect } from 'vitest'
import {
  createOrphanRegistry,
  sessionEndKeepsCard,
  REBIND_WINDOW_MS,
  type LiveTerminals,
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
