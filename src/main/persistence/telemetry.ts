// Story 3.5 — the append-only JSONL telemetry store in MAIN (SM-2 idle/wait timing).
//
// MAIN owns the telemetry; events are written ONLY via `record(event)` — the renderer
// NEVER writes directly. The shape is the versioned Zod `TelemetryEvent` (schema in
// src/shared/schemas/telemetry.ts); this module is the persistence + fail-closed
// boundary around it.
//
// FAIL-CLOSED on a CORRUPT persisted JSONL (AC-2 / .claude/rules/zod-boundaries.md
// persisted-file row): on construction we read all existing JSONL lines and validate each
// one with `parseTelemetryEvent`. Per the persisted-file boundary posture (story 3.5
// FROZEN-2 / AR-9): a SINGLE bad line is the corruption case for a WHOLE-FILE-FAILS-CLOSED
// approach — if ANY line fails, we BACK UP the bad file + START FRESH. This is deliberately
// the PERSISTED-FILE posture (NOT the per-line drop-and-keep of the watch-NDJSON boundary —
// do NOT mix the two). On bad-line recovery the log carries a `code=` ONLY — never the
// file contents. We NEVER throw / crash on corrupt telemetry (PRECEDENCE: fail-closed
// realized as back-up-and-recover, not as a crash).
//
// `record(event)` appends a single JSONL line; a write failure NEVER crashes the caller
// (degrade + code-only log) — same as settings.ts set()'s never-crash write.
//
// DI seam (mirrors createSettingsStore): the underlying line store + `now()` + the `log`
// sink are injectable, so the unit tests use a FAKE in-memory line store (no real
// fs writes, no disk) and a spy log. The REAL fs-backed line store lives in
// `./fsTelemetryLineStore.ts` and is constructed + injected by `src/main/index.ts` —
// this module imports NEITHER electron NOR any fs/node module, so the `main-unit`
// (bare-node) test can import it without crashing on electron's module-eval.
// [Source: story 3.5 Task 2; AC-2; src/main/persistence/settings.ts (DI-seam template);
//  .claude/rules/zod-boundaries.md; architecture.md:746-748; story 3.5 FROZEN-2]
import {
  parseTelemetryEvent,
  TelemetryEventSchema,
  type TelemetryEvent
} from '../../shared/schemas/telemetry'

/**
 * The minimal fs-seam this module needs. Kept tiny so the test fake implements
 * exactly this — and so NO electron / fs import sits on this module's (or the
 * unit-test's) path. The seam is APPEND-ONLY (no random write/overwrite): each call
 * to `append` adds one JSONL record; `readAll` reads ALL existing lines for the
 * corrupt-read validation pass; `backup` renames the bad file to a sidecar.
 */
export interface TelemetryLineStore {
  /** Append one JSONL line (the serialized event + newline) to the telemetry file.
   *  Must NEVER throw out of the store's record() path (see never-crash note). */
  append(line: string): void
  /** Read ALL existing JSONL lines from the telemetry file. Returns [] when the file
   *  does not exist yet (first run) — NOT a corrupt case; start fresh, NO backup. */
  readAll(): string[]
  /** Back up the current bad telemetry file (e.g. rename to a `.corrupt-<epoch>.jsonl`
   *  sidecar). Best-effort: MUST NEVER throw out of the recovery path. */
  backup(): void
}

export interface TelemetryStoreOptions {
  /** The fs-line seam (DI). Tests inject a fake; main injects the real fs-backed store
   *  from `./fsTelemetryLineStore`. If omitted, the store runs IN-MEMORY ONLY (no
   *  persistence) — a safe degrade (never-crash). */
  lineStore?: TelemetryLineStore
  /** Injected clock — epoch-millis for time-based reasoning (AR-11: inject now() for
   *  determinism in tests). Defaults to `Date.now` in production. */
  now?: () => number
  /** Log sink — a `code=` ONLY, NEVER a telemetry/file value (Guardrail #6). Defaults
   *  to console.warn. Injectable so tests can spy without a real console write. */
  log?: (message: string) => void
}

export interface TelemetryStore {
  /** Append a validated telemetry event as a JSONL line. NEVER crashes the caller —
   *  a write failure degrades to a code-only log. Validates the event via the Zod
   *  schema before writing (a direct main-side caller can't bypass the boundary). */
  record(event: TelemetryEvent): void
}

/** A no-op in-memory line store — the default when no `lineStore` is injected. Nothing
 *  is persisted (readAll → [] → fresh start), but the store still works in-session.
 *  This is a safe degrade (never-crash); production injects the real fs-backed store. */
const inMemoryLineStore: TelemetryLineStore = {
  readAll: () => [],
  append: () => {},
  backup: () => {}
}

/**
 * Build the append-only JSONL telemetry store (AC-2). On construction it reads all
 * existing JSONL lines and validates them fail-closed (whole-file-fails-closed: any
 * bad line → back up the file + start fresh — NEVER throws/crashes). `record` appends
 * a validated event and NEVER crashes on write failure. The line store + now() + log
 * are injectable DI seams (tests use a fake in-memory store + spy log — no real fs,
 * no electron). [Source: story 3.5 FROZEN-2; src/main/persistence/settings.ts template]
 */
export function createTelemetryStore(options: TelemetryStoreOptions = {}): TelemetryStore {
  const lineStore = options.lineStore ?? inMemoryLineStore
  // never-log-the-value: a `code=` ONLY, never a telemetry/file value (Guardrail #6).
  const log = options.log ?? ((message: string): void => console.warn(message))

  // --- Corrupt-read fail-closed recovery (AC-2) ----------------------------------------
  // Read ALL persisted JSONL lines ONCE at construction. An empty array = nothing persisted
  // yet (first run) → start fresh, NO backup. Any line that FAILS parseTelemetryEvent =
  // CORRUPT → whole-file-fails-closed: back up the bad file + start fresh (never throw).
  // The log on the recovery path carries a `code=` ONLY — never the file contents.
  let lines: string[]
  try {
    lines = lineStore.readAll()
  } catch {
    // Even READING failed (e.g. fs error) — treat as corrupt-but-unbackable: recover to
    // fresh. Do not attempt a backup of an unreadable file (best-effort).
    log('[c9watch][telemetry] code=telemetry_read_failed')
    lines = []
  }

  if (lines.length > 0) {
    // Validate each line. ANY bad line → whole-file-fails-closed (persisted-file posture,
    // NOT per-line drop — FROZEN-2). Back up the bad file + start fresh. Never crash.
    let corrupt = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue // blank line — tolerate silently
      try {
        const obj: unknown = JSON.parse(trimmed)
        parseTelemetryEvent(obj)
      } catch {
        corrupt = true
        break
      }
    }

    if (corrupt) {
      // CORRUPT telemetry file — back up the bad file + start fresh. Never crash.
      // Log a code ONLY (never the file contents). The backup is best-effort (never throws).
      try {
        lineStore.backup()
      } catch {
        log('[c9watch][telemetry] code=telemetry_backup_failed')
      }
      log('[c9watch][telemetry] code=telemetry_corrupt_reset_to_fresh')
    }
    // Whether corrupt or clean, construction succeeds. If corrupt, future appends go to
    // the fresh file (the bad file was backed up; the store continues writing to the same
    // path the lineStore points at, which is now effectively empty after backup).
  }

  function record(event: TelemetryEvent): void {
    // Validate via the Zod schema — a direct main-side caller can't bypass the boundary.
    // This is a parse-and-validate (not parse-and-throw-to-reject-invoke): record() is
    // called internally from the IPC handler AFTER the arg-parse, so validation here is
    // a defensive double-guard. An invalid event NEVER crashes; it is a code-only log.
    const r = TelemetryEventSchema.safeParse(event)
    if (!r.success) {
      const issue = r.error.issues[0]
      log(
        `[c9watch][telemetry] code=telemetry_invalid_event path=${issue?.path.join('.') ?? ''} zod_code=${issue?.code ?? ''}`
      )
      return
    }

    const line = JSON.stringify(r.data) + '\n'
    try {
      lineStore.append(line)
    } catch {
      // A write failure NEVER crashes the caller. Degrade + code-only log.
      log('[c9watch][telemetry] code=telemetry_write_failed')
    }
  }

  return { record }
}
