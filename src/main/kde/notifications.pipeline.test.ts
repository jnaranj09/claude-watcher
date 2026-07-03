// Story 2.2 — the notifier PIPELINE test (main-unit / node project).
// Story 3.3 — extended with the launched-vs-external membership gate at the emission source.
// Story 6.4 — migrated to the NATIVE ENGINE drivers: sessions are born via
// `reducer.upsertLaunched` and transitioned/removed via `reducer.applyHookStatus`
// (the retired c9watch seed/line drivers are gone; the notifier + wiring are UNCHANGED).
//
// Mirrors production (`main/index.ts#handleDelta`): drive the REAL reducer + REAL tracker
// with the launched-session fixtures, then feed the tracker's `raisedEvents` array into
// the REAL notifier (with a fake notificationFactory DI seam) — GATED on launched-set
// membership (`isLaunched(raised.id)`), exactly as production gates the
// `attention.raised` emission at the source. This proves the WIRING contract end-to-end
// without a live claude, a real OS notification, or any Electron import:
//   - AC-1: a needs-you ENTRY edge for a LAUNCHED session → exactly ONE notify.
//   - AC-2: a working/idle ENTRY and a session.removed → ZERO notify (the notifier only
//     ever sees the tracker's needs-you-entry output).
//   - Story 3.3 / AC-3: a needs-you ENTRY for an EXTERNAL (non-launched) session → ZERO
//     notify (the membership gate drops the emission at the source).
// Uses injected now() for determinism.
import { describe, it, expect } from 'vitest'
import { createReducer, type SessionDelta } from '../c9watch/reducer'
import { createAttentionTracker } from '../c9watch/attention'
import {
  createAttentionNotifier,
  type NotificationLike,
  type NotificationOptions
} from './notifications'
import type { Session } from '../../shared/schemas/session'
import {
  fakeLaunchedSessions,
  launchedSession,
  WORKING_ID,
  IDLE_ID,
  NEEDS_ATTENTION_ID
} from '../../__fixtures__/fakeSessions'

const FIXED_NOW = 1_750_000_000_000

/** Build the production-shaped pipeline: reducer → tracker → (membership gate) → notifier
 *  (fake factory). Returns the native-engine drivers and the notifications shown. Mirrors
 *  index.ts handleDelta: tracker.onDelta FIRST (returns raisedEvents), then — for each
 *  raised event — notify ONLY when `isLaunched(raised.id)` (the Story-3.3 emission gate).
 *
 *  @param isLaunched the app-launched-vs-external predicate (default ALL-LAUNCHED, so the
 *    pre-3.3 cases keep their counts). The Story-3.3 cases inject an explicit set. */
function pipeline(isLaunched: (id: string) => boolean = () => true): {
  launchAll(): void
  launch(session: Session): void
  hook(id: string, status: string): void
  remove(id: string): void
  shownCount: () => number
  shown: () => NotificationOptions[]
} {
  const now = (): number => FIXED_NOW
  const reducer = createReducer({ now })
  const tracker = createAttentionTracker({ now })
  const shown: NotificationOptions[] = []
  const factory = (opts: NotificationOptions): NotificationLike => ({
    show(): void {
      shown.push(opts)
    }
  })
  const notifier = createAttentionNotifier({ notificationFactory: factory })

  function route(deltas: SessionDelta[]): void {
    for (const d of deltas) {
      // Fresh map snapshot per delta (mirrors production handleDelta).
      const map = reducer.snapshotMap()
      const raisedEvents = tracker.onDelta(d, map)
      // Story 3.3 — the EMISSION gate at the source: skip a raise for an EXTERNAL
      // (non-launched) session, exactly as index.ts handleDelta does. 1:1 notify for
      // each LAUNCHED raise (NO extra debounce; the tracker already debounced).
      for (const raised of raisedEvents) {
        if (!isLaunched(raised.id)) continue
        notifier.notify(raised)
      }
    }
  }
  return {
    launchAll: () => {
      for (const s of fakeLaunchedSessions()) route(reducer.upsertLaunched(s))
    },
    launch: (session) => route(reducer.upsertLaunched(session)),
    hook: (id, status) => route(reducer.applyHookStatus(id, { kind: 'status', status })),
    remove: (id) => route(reducer.applyHookStatus(id, { kind: 'removed' })),
    shownCount: () => shown.length,
    shown: () => shown
  }
}

describe('notifier pipeline — fires 1:1 on a needs-you ENTRY (AC-1)', () => {
  it('a Working→NeedsPermission entry edge fires exactly ONE notification with the tool name', () => {
    const p = pipeline()
    p.launchAll() // first observations suppress raises (no launch storm)
    expect(p.shownCount()).toBe(0)
    // A Working session that carries a pending tool crosses into needs-you → ONE notify
    // whose body names the tool (the raise reads pendingToolName off the stored session).
    const id = 'aaaa2222-0000-4000-8000-000000000001'
    p.launch(launchedSession(id, { status: 'Working', pendingToolName: 'Bash' }))
    p.hook(id, 'NeedsPermission')
    expect(p.shownCount()).toBe(1)
    const opts = p.shown()[0]
    expect(opts?.title).toContain('needs you')
    expect(opts?.body).toContain('Bash')
  })
})

describe('notifier pipeline — NEVER fires on working/idle entry or removal (AC-2)', () => {
  it('an idle (WaitingForInput) ENTRY fires ZERO notifications', () => {
    const p = pipeline()
    p.launchAll() // dashboard is Working
    p.hook(WORKING_ID, 'WaitingForInput') // entering IDLE → no raise → ZERO notify
    expect(p.shownCount()).toBe(0)
  })

  it('a working ENTRY (idle→Working) fires ZERO notifications', () => {
    const p = pipeline()
    p.launchAll() // auth is WaitingForInput → idle
    expect(p.shownCount()).toBe(0)
    p.hook(IDLE_ID, 'Working') // entering WORKING → no raise → ZERO notify
    expect(p.shownCount()).toBe(0)
  })

  it('a session.removed (stop/exit/SessionEnd removal) fires ZERO notifications', () => {
    const p = pipeline()
    p.launchAll()
    // Remove a NEEDS-YOU session (webapp is NeedsAttention) — removal must NOT notify.
    p.remove(NEEDS_ATTENTION_ID)
    expect(p.shownCount()).toBe(0)
  })
})

describe('notifier pipeline — launched-only emission gate (Story 3.3 / AC-3; F4 behavior change)', () => {
  it('an EXTERNAL (non-launched) needs-you ENTRY fires ZERO notifications', () => {
    // dashboard is NOT in the launched-set → its needs-you entry must NOT notify.
    // Gating the emission at the source ALSO means no renderer attention.raised → no
    // sound, and no notification → no jump-to-card.
    const p = pipeline(() => false) // nothing launched
    p.launchAll()
    expect(p.shownCount()).toBe(0)
    p.hook(WORKING_ID, 'NeedsAttention')
    expect(p.shownCount()).toBe(0)
  })

  it('a LAUNCHED needs-you ENTRY fires exactly ONE notification (the positive case)', () => {
    // Same entry edge as the external case — but now gated by an explicit launched-set
    // containing dashboard's id → ONE notify. Proves the gate is the ONLY difference.
    const p = pipeline((id) => id === WORKING_ID)
    p.launchAll()
    expect(p.shownCount()).toBe(0)
    p.hook(WORKING_ID, 'NeedsAttention')
    expect(p.shownCount()).toBe(1)
  })

  it('a launched + external mix notifies ONLY for the launched session', () => {
    // Two sessions cross into needs-you on the same engine; only the launched one notifies.
    const p = pipeline((id) => id === WORKING_ID) // dashboard launched, auth external
    p.launchAll()
    p.hook(WORKING_ID, 'NeedsAttention') // launched → notify
    p.hook(IDLE_ID, 'NeedsPermission') // external → ZERO
    expect(p.shownCount()).toBe(1)
  })
})
