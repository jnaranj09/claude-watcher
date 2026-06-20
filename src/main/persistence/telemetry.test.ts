// Story 3.5 — the telemetry store tests (main-unit / node project).
//
// Inject a FAKE in-memory TelemetryLineStore (the DI seam) + a spy `log` + injected
// `now()` so NO real fs writes, NO disk, and NO electron import are loaded on the
// test path. Asserts:
//   - AC-2: first run (empty) returns a working store; record appends as JSONL.
//   - AC-2: a CORRUPT persisted JSONL file → backup taken + fresh start (NEVER throws).
//   - AC-2: a write failure degrades (code-only log, no crash).
//   - AC-2: the corrupt-read log carries a `code=` ONLY (never-log-the-value).
//   - AC-2: multiple records append in order.
//   - AC-3/4: injected now()/fake line store asserts NO real fs writes.
// [Source: story 3.5 Task 2.5; AC-2; .claude/rules/zod-boundaries.md; settings.test.ts style]
import { describe, it, expect, vi } from 'vitest'
import { createTelemetryStore, type TelemetryLineStore } from './telemetry'
import type { TelemetryEvent } from '../../shared/schemas/telemetry'

const TELEMETRY_VERSION = 1

const validEvent: TelemetryEvent = {
  version: TELEMETRY_VERSION,
  kind: 'idle-wait',
  sessionId: 'abc-123-uuid',
  column: 'needs-you',
  enteredColumnAt: 1000,
  acknowledgedAt: 5000,
  waitMs: 4000,
  launched: true
}

/** A capturing fake line store: holds in-memory lines, records appends + backup calls. */
function makeFakeLineStore(existingLines: string[] = []): {
  lineStore: TelemetryLineStore
  appended: string[]
  backupCount: () => number
} {
  const lines: string[] = [...existingLines]
  const appended: string[] = []
  let backups = 0
  const lineStore: TelemetryLineStore = {
    readAll: () => [...lines],
    append: (line: string) => {
      appended.push(line)
      lines.push(line)
    },
    backup: () => {
      backups++
    }
  }
  return { lineStore, appended, backupCount: () => backups }
}

/** A fake line store whose append() throws — to test the never-crash degrade. */
function makeFailingAppendLineStore(): {
  lineStore: TelemetryLineStore
  backupCount: () => number
} {
  let backups = 0
  const lineStore: TelemetryLineStore = {
    readAll: () => [],
    append: () => {
      throw new Error('disk full')
    },
    backup: () => {
      backups++
    }
  }
  return { lineStore, backupCount: () => backups }
}

/** A fake line store whose readAll() throws — to test the read-failure degrade. */
function makeFailingReadLineStore(): TelemetryLineStore {
  return {
    readAll: () => {
      throw new Error('permission denied')
    },
    append: () => {},
    backup: () => {}
  }
}

describe('createTelemetryStore — first run + record (AC-2)', () => {
  it('first run (empty) returns a working store without backing up', () => {
    const fake = makeFakeLineStore([])
    const log = vi.fn()
    let store: ReturnType<typeof createTelemetryStore> | undefined
    expect(() => {
      store = createTelemetryStore({ lineStore: fake.lineStore, log })
    }).not.toThrow()
    // No backup on first run.
    expect(fake.backupCount()).toBe(0)
    expect(log).not.toHaveBeenCalled()
    expect(store).toBeDefined()
  })

  it('record appends a valid event as a JSONL line (newline-terminated)', () => {
    const fake = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore: fake.lineStore })
    store.record(validEvent)
    expect(fake.appended).toHaveLength(1)
    const line = fake.appended[0]!
    expect(line).toMatch(/\n$/)
    const parsed: unknown = JSON.parse(line.trim())
    expect(parsed).toEqual(validEvent)
  })

  it('multiple records append in order', () => {
    const fake = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore: fake.lineStore })
    const event1: TelemetryEvent = { ...validEvent, sessionId: 'sess-1', waitMs: 1000 }
    const event2: TelemetryEvent = {
      ...validEvent,
      sessionId: 'sess-2',
      waitMs: 2000,
      column: 'idle'
    }
    store.record(event1)
    store.record(event2)
    expect(fake.appended).toHaveLength(2)
    expect(JSON.parse(fake.appended[0]!.trim())).toMatchObject({ sessionId: 'sess-1' })
    expect(JSON.parse(fake.appended[1]!.trim())).toMatchObject({ sessionId: 'sess-2' })
  })

  it('loads a VALID existing JSONL file without backup or error', () => {
    const validLine = JSON.stringify(validEvent) + '\n'
    const fake = makeFakeLineStore([validLine])
    const log = vi.fn()
    expect(() => createTelemetryStore({ lineStore: fake.lineStore, log })).not.toThrow()
    expect(fake.backupCount()).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('createTelemetryStore — corrupt JSONL: whole-file fails closed (AC-2 FROZEN-2)', () => {
  it('a CORRUPT existing JSONL file backs up and starts fresh (does NOT throw)', () => {
    const corrupt = '{ "this": "is not a valid telemetry event" }\n'
    const fake = makeFakeLineStore([corrupt])
    const log = vi.fn()
    let store: ReturnType<typeof createTelemetryStore> | undefined
    expect(() => {
      store = createTelemetryStore({ lineStore: fake.lineStore, log })
    }).not.toThrow()
    // Backup taken on corruption.
    expect(fake.backupCount()).toBe(1)
    expect(store).toBeDefined()
  })

  it('the corrupt-read log carries a `code=` ONLY — never the corrupt value (Guardrail #6)', () => {
    const corrupt = JSON.stringify({ version: 99, kind: 'idle-wait', sessionId: 'SECRETID' }) + '\n'
    const fake = makeFakeLineStore([corrupt])
    const log = vi.fn()
    createTelemetryStore({ lineStore: fake.lineStore, log })
    expect(log).toHaveBeenCalled()
    const allLogged = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allLogged).toContain('code=telemetry_corrupt_reset_to_fresh')
    // NEVER log the corrupt value contents.
    expect(allLogged).not.toContain('SECRETID')
    expect(allLogged).not.toContain('99')
  })

  it('a bad JSON line (non-parseable) is treated as corrupt → backup + fresh start', () => {
    const fake = makeFakeLineStore(['NOT JSON AT ALL\n'])
    const log = vi.fn()
    expect(() => createTelemetryStore({ lineStore: fake.lineStore, log })).not.toThrow()
    expect(fake.backupCount()).toBe(1)
  })

  it('a wrong-version event is treated as corrupt → backup + fresh start', () => {
    const wrongVersion = JSON.stringify({ ...validEvent, version: 99 }) + '\n'
    const fake = makeFakeLineStore([wrongVersion])
    const log = vi.fn()
    expect(() => createTelemetryStore({ lineStore: fake.lineStore, log })).not.toThrow()
    expect(fake.backupCount()).toBe(1)
  })

  it('a negative-waitMs event in the file is treated as corrupt → whole-file backup + fresh', () => {
    const badEvent = JSON.stringify({ ...validEvent, waitMs: -100 }) + '\n'
    const fake = makeFakeLineStore([badEvent])
    const log = vi.fn()
    expect(() => createTelemetryStore({ lineStore: fake.lineStore, log })).not.toThrow()
    expect(fake.backupCount()).toBe(1)
  })

  it('multiple lines where FIRST is good and SECOND is corrupt → whole-file backup', () => {
    const goodLine = JSON.stringify(validEvent) + '\n'
    const badLine = '{ bad json }\n'
    const fake = makeFakeLineStore([goodLine, badLine])
    const log = vi.fn()
    expect(() => createTelemetryStore({ lineStore: fake.lineStore, log })).not.toThrow()
    // Whole-file backup even though first line was good.
    expect(fake.backupCount()).toBe(1)
  })

  it('after corrupt-read + backup, new records append successfully (fresh start continues writing)', () => {
    const corrupt = '{ bad }\n'
    const fake = makeFakeLineStore([corrupt])
    const store = createTelemetryStore({ lineStore: fake.lineStore, log: vi.fn() })
    store.record(validEvent)
    // One new line appended post-backup.
    expect(fake.appended).toHaveLength(1)
  })

  it('a failed readAll() degrades to fresh start without backup (unreadable file)', () => {
    const lineStore = makeFailingReadLineStore()
    const log = vi.fn()
    expect(() => createTelemetryStore({ lineStore, log })).not.toThrow()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('code=telemetry_read_failed'))
  })
})

describe('createTelemetryStore — write failure degrades (never-crash, AC-2)', () => {
  it('a write failure does NOT crash the caller — degrades to code-only log', () => {
    const { lineStore } = makeFailingAppendLineStore()
    const log = vi.fn()
    const store = createTelemetryStore({ lineStore, log })
    expect(() => store.record(validEvent)).not.toThrow()
    expect(log).toHaveBeenCalled()
    const allLogged = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allLogged).toContain('code=telemetry_write_failed')
    // Never log the event value.
    expect(allLogged).not.toContain('abc-123-uuid')
  })
})

describe('createTelemetryStore — no real userData writes (DI injected, AC-2)', () => {
  it('uses only the injected fake line store — no node:fs or electron on the test path', () => {
    // This test simply importing and running the store is the guarantee (no real fs import).
    const fake = makeFakeLineStore()
    const store = createTelemetryStore({ lineStore: fake.lineStore, now: () => 99999 })
    store.record(validEvent)
    expect(fake.appended).toHaveLength(1)
  })
})
