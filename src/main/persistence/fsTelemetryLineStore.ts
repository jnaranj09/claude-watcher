// Story 3.5 — the REAL fs-backed `TelemetryLineStore` (MAIN only).
//
// This is the ONLY place `node:fs` + `app.getPath('userData')` are imported/used for
// telemetry. It is imported ONLY by `src/main/index.ts` (the real main process), NEVER
// by `./telemetry.ts` or any unit test — because electron imports would crash the
// bare-node `main-unit` test runtime. Keeping it in this dedicated file (injected as
// the `lineStore` DI seam into `createTelemetryStore`) preserves the unit-testability
// of `telemetry.ts`. [Source: story 3.5 Task 2.2; src/main/persistence/electronSettingsBlobStore.ts
//  (Electron-touching file kept OFF the unit-test path — same pattern)]
//
// The JSONL file lives at `userData/c9watch-telemetry.jsonl`. Appends are synchronous
// (appendFileSync) so each record is durable without a flush-and-close cycle. The backup
// renames the file to a timestamped `.corrupt-<epoch>.jsonl` sidecar (best-effort — never
// throws out of the recovery path). [Source: story 3.5 FROZEN-2; architecture.md:421-423]
import { appendFileSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { TelemetryLineStore } from './telemetry'

const TELEMETRY_FILENAME = 'c9watch-telemetry.jsonl'

/**
 * Construct the fs-backed telemetry line store. The JSONL file is opened lazily
 * (the first append creates it if absent). `app.getPath('userData')` MUST be
 * available before calling this (i.e., called AFTER `app-ready`).
 *
 * This factory is called once from main AFTER `app` is ready, then injected into
 * `createTelemetryStore` as the `lineStore` DI seam.
 */
export function createFsTelemetryLineStore(userDataPath: string): TelemetryLineStore {
  const filePath = join(userDataPath, TELEMETRY_FILENAME)

  return {
    readAll(): string[] {
      try {
        const raw = readFileSync(filePath, 'utf-8')
        // Split on newline; the last element may be empty (trailing newline) — tolerated.
        return raw.split('\n')
      } catch (err) {
        // File not found (first run) = [] (NOT a corrupt case — just no file yet).
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return []
        }
        // Other fs error — rethrow so createTelemetryStore treats it as corrupt-unbackable.
        throw err
      }
    },

    append(line: string): void {
      // appendFileSync creates the file if it doesn't exist (no pre-create needed).
      appendFileSync(filePath, line, 'utf-8')
    },

    backup(): void {
      // Preserve the corrupt file: rename it to a timestamped sidecar so it is available
      // for inspection and not silently destroyed.
      const to = filePath.replace(/\.jsonl$/i, '') + `.corrupt-${Date.now()}.jsonl`
      try {
        renameSync(filePath, to)
      } catch {
        // Best-effort: if the rename fails (file missing/locked), recovery still proceeds.
      }
    }
  }
}
