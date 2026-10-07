// Session-rebind — the mid-run session-id change guard (Part 1) + adoption proof (Part 2).
//
// Every assertion here is a FAULT INJECTION target: deleting the guard it covers in
// sessionRebind.ts must turn the matching test red. The four adoption conditions (exact cwd,
// exactly one match, pty alive, inside the window) each get their own negative case, because
// loosening ANY of them re-opens the Story-3.3 ship gate (external sessions on the board).

import { describe, it, expect, vi } from 'vitest'
import {
  claimByProcess,
  claimUnlessParked,
  createOrphanRegistry,
  findAdoptionTarget,
  namedByShellPane,
  isAdoptableSessionId,
  isAgentListNotification,
  keepCardOnLiveSessionEnd,
  parkedAwayFromJob,
  sessionEndKeepsCard,
  REBIND_WINDOW_MS,
  type LiveTerminals,
  type ParkedRecords,
  type ProcessSessionRecords,
  type RebindBindingSource
} from './sessionRebind'
import type { HookStatusChange } from '../c9watch/reducer'
import { HookEventSchema, type HookEvent } from '../../shared/schemas/hookEvent'

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

  // Agent view — the records source lists a parked terminal by its JOB's id only (Task 2), so
  // the job's first hook re-keys the card, and an agent-list hook under the OLD id never re-keys
  // it back.
  it('parked: adopts the job id, and after the re-key never adopts the old id back', () => {
    const first = claimByProcess(
      'job-sess',
      [{ terminalId: 'term-1', sessionId: 'sess-orig' }],
      pids({ 'term-1': 111 }),
      recorded({ 111: ['job-sess'] })
    )
    expect(first).toEqual({ terminalId: 'term-1', sessionId: 'sess-orig' })
    const back = claimByProcess(
      'sess-orig',
      [{ terminalId: 'term-1', sessionId: 'job-sess' }],
      pids({ 'term-1': 111 }),
      recorded({ 111: ['job-sess'] })
    )
    expect(back).toBeNull()
  })

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
  it('a claude inside a card SHELL PANE names the id: never adopted, the orphan is left alone', () => {
    // Card shell pane — a `claude` the operator runs in the shell is in the SAME folder as the
    // card's claude, so the cwd heuristic alone would hand it the card after a /clear.
    const byOrphan = vi.fn(() => hit)
    const log = vi.fn()
    expect(
      findAdoptionTarget(NEW_ID, { byProcess: () => null, byOrphan, byCompanion: () => true }, log)
    ).toBeNull()
    expect(byOrphan).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      '[c9watch][hooks] path=(hook) code=hook_rebind_shell_pane_claude'
    )
  })
  it('no shell pane names the id: the cwd fallback still runs', () => {
    expect(
      findAdoptionTarget(
        NEW_ID,
        { byProcess: () => null, byOrphan: () => hit, byCompanion: () => false },
        vi.fn()
      )
    ).toEqual({ ...hit, proof: 'cwd' })
  })
})

describe('namedByShellPane — the disproof source for a claude run inside a card shell pane', () => {
  const NEW_ID = '3f2b8c1e-9a4d-4e7f-8b2c-1d0e6f5a7b9c'
  const pids = { pidOf: (id: string) => (id === 'launch-1:shell' ? 42 : null) }
  it('true when a live shell pane records the id', () => {
    const records = { currentSessionIdsUnder: (pid: number) => (pid === 42 ? [NEW_ID] : []) }
    expect(namedByShellPane(NEW_ID, ['launch-1:shell'], pids, records)).toBe(true)
  })
  it('false when no shell pane records it, or the shell pty is gone', () => {
    const none = { currentSessionIdsUnder: () => [] }
    expect(namedByShellPane(NEW_ID, ['launch-1:shell'], pids, none)).toBe(false)
    const any = { currentSessionIdsUnder: () => [NEW_ID] }
    expect(namedByShellPane(NEW_ID, ['launch-2:shell'], pids, any)).toBe(false)
  })
})

// The SessionEnd step watchFeed runs: keep the card on a live pty, and on a /clear move it to
// idle (ST-7 — claude sends no SessionStart to an http hook, so this is the only /clear signal).
describe('keepCardOnLiveSessionEnd (watchFeed SessionEnd step)', () => {
  function setup(
    live: LiveTerminals,
    parked = false
  ): {
    run: (body: Record<string, unknown>) => boolean
    applied: { sessionId: string; change: HookStatusChange }[]
    orphans: ReturnType<typeof createOrphanRegistry>
  } {
    const applied: { sessionId: string; change: HookStatusChange }[] = []
    const orphans = createOrphanRegistry()
    return {
      run: (body) =>
        keepCardOnLiveSessionEnd(
          HookEventSchema.parse({
            session_id: 'sess-a',
            hook_event_name: 'SessionEnd',
            cwd: '/w',
            ...body
          }),
          {
            launch: bindings({ 'sess-a': 'term-1' }),
            live,
            orphans,
            parked: () => parked,
            now: T0,
            applyStatus: (sessionId, change) => applied.push({ sessionId, change }),
            log: () => undefined
          }
        ),
      applied,
      orphans
    }
  }

  it('/clear on a live pty: keeps the card, marks the orphan, moves the OLD id to idle', () => {
    const { run, applied, orphans } = setup(alive('term-1'))
    expect(run({ reason: 'clear' })).toBe(true)
    expect(orphans.size()).toBe(1)
    expect(applied).toEqual([
      { sessionId: 'sess-a', change: { kind: 'status', status: 'WaitingForInput' } }
    ])
  })

  it('another reason on a live pty: keeps the card, status untouched', () => {
    const { run, applied, orphans } = setup(alive('term-1'))
    expect(run({ reason: 'other' })).toBe(true)
    expect(orphans.size()).toBe(1)
    expect(applied).toEqual([])
  })

  it('a PARKED terminal (agent view): keeps the card but marks NO orphan', () => {
    // A session started from the agent list runs in the same folder; an orphan would let the
    // cwd fallback hand it this card. The parked job is found by the exact proof instead.
    const { run, applied, orphans } = setup(alive('term-1'), true)
    expect(run({ reason: 'clear' })).toBe(true)
    expect(orphans.size()).toBe(0)
    expect(applied).toEqual([
      { sessionId: 'sess-a', change: { kind: 'status', status: 'WaitingForInput' } }
    ])
  })

  it('a dead pty: not kept (a real removal), nothing applied, no orphan', () => {
    const { run, applied, orphans } = setup(alive())
    expect(run({ reason: 'clear' })).toBe(false)
    expect(orphans.size()).toBe(0)
    expect(applied).toEqual([])
  })
})

describe('isAgentListNotification — agent-view chatter never moves the card', () => {
  const notif = (sessionId: string, type = 'agent_needs_input'): HookEvent =>
    HookEventSchema.parse({
      session_id: sessionId,
      hook_event_name: 'Notification',
      notification_type: type
    })
  const launch = bindings({ 'sess-orig': 'term-1', 'job-sess': 'term-2' })
  /** term-1 is parked to a job whose current id is `job-sess`; term-2 is that re-keyed card. */
  const parkedAway = (terminalId: string, sessionId: string): boolean =>
    (terminalId === 'term-1' || terminalId === 'term-2') && sessionId !== 'job-sess'

  it('drops a Notification under the OLD id of a parked terminal (another agent asks)', () => {
    expect(
      isAgentListNotification(notif('sess-orig'), { launch, live: alive('term-1'), parkedAway })
    ).toBe(true)
  })

  it("keeps the parked job's OWN permission prompt after the re-key (card goes to Needs you)", () => {
    expect(
      isAgentListNotification(notif('job-sess', 'permission_prompt'), {
        launch,
        live: alive('term-2'),
        parkedAway
      })
    ).toBe(false)
  })

  it('keeps every Notification of a terminal that is not parked', () => {
    expect(
      isAgentListNotification(notif('sess-orig', 'permission_prompt'), {
        launch,
        live: alive('term-1'),
        parkedAway: () => false
      })
    ).toBe(false)
  })

  it('ignores other events, unknown ids and dead terminals', () => {
    const stop = HookEventSchema.parse({ session_id: 'sess-orig', hook_event_name: 'Stop' })
    expect(isAgentListNotification(stop, { launch, live: alive('term-1'), parkedAway })).toBe(false)
    expect(
      isAgentListNotification(notif('nobody'), { launch, live: alive('term-1'), parkedAway })
    ).toBe(false)
    expect(isAgentListNotification(notif('sess-orig'), { launch, live: alive(), parkedAway })).toBe(
      false
    )
  })
})

describe('parkedAwayFromJob — drop only on POSITIVE evidence', () => {
  const records = (parked: boolean, ids: readonly string[]): ParkedRecords => ({
    parkedUnder: () => parked,
    currentSessionIdsUnder: () => ids
  })

  it('parked, job id readable, event under another id → away (agent-list chatter)', () => {
    expect(parkedAwayFromJob('sess-orig', 111, records(true, ['job-sess']))).toBe(true)
  })

  it("parked, event under the job's own id → not away (the job's own Notification)", () => {
    expect(parkedAwayFromJob('job-sess', 111, records(true, ['job-sess']))).toBe(false)
  })

  it('parked but NO job id readable (record not written / torn) → not away: keep the event', () => {
    expect(parkedAwayFromJob('job-sess', 111, records(true, []))).toBe(false)
  })

  it('not parked → never away', () => {
    expect(parkedAwayFromJob('sess-orig', 111, records(false, ['other']))).toBe(false)
  })
})

describe('claimUnlessParked — an orphan from before ← is never claimed while parked', () => {
  const orphan = { terminalId: 'term-1', sessionId: 'sess-old', cwd: '/w', orphanedAt: T0 }

  it('refuses an orphan whose terminal is parked (agent-list session in the same cwd)', () => {
    expect(claimUnlessParked(orphan, (t) => t === 'term-1')).toBeNull()
  })

  it('passes an orphan through when its terminal is not parked (plain /clear)', () => {
    expect(claimUnlessParked(orphan, () => false)).toBe(orphan)
  })

  it('passes null through', () => {
    expect(claimUnlessParked(null, () => true)).toBeNull()
  })
})
