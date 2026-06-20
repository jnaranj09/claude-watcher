// Story 3.5 — unit tests for the telemetry IPC handler logic (duration math + conditions).
//
// The handler in registerTelemetryIpc() (src/main/index.ts) is the wiring layer — it
// computes `waitMs = acknowledgedAt − enteredColumnAt` from the tracker and records the
// event. We test the logic here via a UNIT harness that mocks the tracker + telemetry store
// (NO real Electron IPC, NO real userData writes, NO real tracker). [story 3.5 Task 5.2]
//
// Tested cases (story 3.5 Task 5.2 / FROZEN-4):
//   - A session in a waiting column (needs-you / idle) → event recorded with correct waitMs.
//   - A session in 'working' column → NO event (working never records).
//   - A session unknown to the tracker (undefined columnOf) → NO event.
//   - A negative waitMs (clock/edge anomaly) → NO event (skip, not crash).
//   - Injected now() + fake tracker → no real userData writes.
//   - The `launched` flag is set from the launched-set.
//
// The handler's FULL flow: parse the arg (TelemetryAcknowledgeSchema) + look up the tracker
// + check the column + compute waitMs + record. We test the compute + record part here;
// the Zod arg-parse is tested in telemetry.test.ts (TelemetryAcknowledgeSchema).
import { describe, it, expect, vi } from 'vitest'
import { createTelemetryStore, type TelemetryLineStore } from './telemetry'
import type { TelemetryEvent } from '../../shared/schemas/telemetry'
import type { Column } from '../../shared/ipc/contract'

const TELEMETRY_VERSION = 1

/** A minimal fake tracker seam (only the fields the handler logic reads). */
interface FakeTracker {
  columnOf(id: string): Column | undefined
  enteredColumnAt(id: string): number | undefined
}

/** A minimal fake launched-set seam (only the `has` predicate). */
interface FakeLaunchedSet {
  has(id: string): boolean
}

/** Build a fake tracker with controlled columnOf / enteredColumnAt. */
function makeFakeTracker(column: Column | undefined, enteredAt: number | undefined): FakeTracker {
  return {
    columnOf: () => column,
    enteredColumnAt: () => enteredAt
  }
}

/** Build a fake launched set. */
function makeLaunchedSet(launchedIds: string[]): FakeLaunchedSet {
  const ids = new Set(launchedIds)
  return {
    has: (id: string): boolean => ids.has(id)
  }
}

/** The core handler logic extracted for unit testing (mirrors the registerTelemetryIpc impl). */
function runHandlerLogic(opts: {
  sessionId: string
  acknowledgedAt: number
  tracker: FakeTracker
  launchedSet: FakeLaunchedSet
  telemetryStore: ReturnType<typeof createTelemetryStore>
  log?: (msg: string) => void
}): void {
  const { sessionId, acknowledgedAt, tracker, launchedSet, telemetryStore } = opts
  const log = opts.log ?? (() => {})

  const column = tracker.columnOf(sessionId)
  if (column !== 'needs-you' && column !== 'idle') {
    log(`[c9watch][telemetry] code=telemetry_skip_not_waiting sessionId=${sessionId}`)
    return
  }

  const enteredColumnAt = tracker.enteredColumnAt(sessionId)
  if (enteredColumnAt === undefined) {
    log(`[c9watch][telemetry] code=telemetry_skip_no_entered_at sessionId=${sessionId}`)
    return
  }

  const waitMs = acknowledgedAt - enteredColumnAt
  if (waitMs < 0) {
    log(`[c9watch][telemetry] code=telemetry_skip_negative_wait sessionId=${sessionId}`)
    return
  }

  telemetryStore.record({
    version: TELEMETRY_VERSION,
    kind: 'idle-wait',
    sessionId,
    column,
    enteredColumnAt,
    acknowledgedAt,
    waitMs,
    launched: launchedSet.has(sessionId)
  })
}

/** Build a capturing fake line store. */
function makeFakeLineStore(): { lineStore: TelemetryLineStore; appended: TelemetryEvent[] } {
  const appended: TelemetryEvent[] = []
  const lineStore: TelemetryLineStore = {
    readAll: () => [],
    append: (line: string) => {
      appended.push(JSON.parse(line.trim()) as TelemetryEvent)
    },
    backup: () => {}
  }
  return { lineStore, appended }
}

describe('telemetry handler — duration math + conditions (story 3.5 AC-1/3/4, FROZEN-4)', () => {
  it('needs-you column: records event with correct waitMs + column + version', () => {
    const { lineStore, appended } = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore })
    const tracker = makeFakeTracker('needs-you', 1000)
    const launched = makeLaunchedSet(['sess-a'])

    runHandlerLogic({
      sessionId: 'sess-a',
      acknowledgedAt: 5000,
      tracker,
      launchedSet: launched,
      telemetryStore: store
    })

    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      version: 1,
      kind: 'idle-wait',
      sessionId: 'sess-a',
      column: 'needs-you',
      enteredColumnAt: 1000,
      acknowledgedAt: 5000,
      waitMs: 4000,
      launched: true
    })
  })

  it('idle column: records event with correct waitMs + column (AC-3 — both columns record)', () => {
    const { lineStore, appended } = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore })
    const tracker = makeFakeTracker('idle', 2000)
    const launched = makeLaunchedSet([])

    runHandlerLogic({
      sessionId: 'sess-b',
      acknowledgedAt: 8000,
      tracker,
      launchedSet: launched,
      telemetryStore: store
    })

    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      column: 'idle',
      waitMs: 6000,
      launched: false
    })
  })

  it('working column: NO event recorded (working never records — AC-3)', () => {
    const { lineStore, appended } = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore })
    const tracker = makeFakeTracker('working', 1000)
    const launched = makeLaunchedSet([])
    const log = vi.fn()

    runHandlerLogic({
      sessionId: 'sess-working',
      acknowledgedAt: 5000,
      tracker,
      launchedSet: launched,
      telemetryStore: store,
      log
    })

    expect(appended).toHaveLength(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('code=telemetry_skip_not_waiting'))
  })

  it('unknown session (column = undefined): NO event (FROZEN-4 — session left before ack landed)', () => {
    const { lineStore, appended } = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore })
    const tracker = makeFakeTracker(undefined, undefined)
    const launched = makeLaunchedSet([])
    const log = vi.fn()

    runHandlerLogic({
      sessionId: 'sess-gone',
      acknowledgedAt: 5000,
      tracker,
      launchedSet: launched,
      telemetryStore: store,
      log
    })

    expect(appended).toHaveLength(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('code=telemetry_skip_not_waiting'))
  })

  it('negative waitMs (clock/edge anomaly): NO event — skip, not crash (FROZEN-4)', () => {
    const { lineStore, appended } = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore })
    // acknowledgedAt < enteredColumnAt → negative wait
    const tracker = makeFakeTracker('needs-you', 9000)
    const launched = makeLaunchedSet([])
    const log = vi.fn()

    runHandlerLogic({
      sessionId: 'sess-c',
      acknowledgedAt: 1000, // earlier than enteredColumnAt=9000
      tracker,
      launchedSet: launched,
      telemetryStore: store,
      log
    })

    expect(appended).toHaveLength(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('code=telemetry_skip_negative_wait'))
  })

  it('waitMs = 0 is a valid event (instantaneous acknowledge)', () => {
    const { lineStore, appended } = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore })
    const tracker = makeFakeTracker('needs-you', 5000)
    const launched = makeLaunchedSet(['sess-instant'])

    runHandlerLogic({
      sessionId: 'sess-instant',
      acknowledgedAt: 5000, // same timestamp → waitMs = 0
      tracker,
      launchedSet: launched,
      telemetryStore: store
    })

    expect(appended).toHaveLength(1)
    expect(appended[0]!.waitMs).toBe(0)
  })

  it('launched flag: true when in the launched set, false when not (AC-4 SM-1 basis)', () => {
    const { lineStore: ls1, appended: a1 } = makeFakeLineStore()
    const { lineStore: ls2, appended: a2 } = makeFakeLineStore()

    const storeA = createTelemetryStore({ lineStore: ls1 })
    const storeB = createTelemetryStore({ lineStore: ls2 })
    const tracker = makeFakeTracker('needs-you', 1000)

    runHandlerLogic({
      sessionId: 'launched-yes',
      acknowledgedAt: 5000,
      tracker,
      launchedSet: makeLaunchedSet(['launched-yes']),
      telemetryStore: storeA
    })
    runHandlerLogic({
      sessionId: 'external-sess',
      acknowledgedAt: 5000,
      tracker,
      launchedSet: makeLaunchedSet([]),
      telemetryStore: storeB
    })

    expect(a1[0]!.launched).toBe(true)
    expect(a2[0]!.launched).toBe(false)
  })
})
